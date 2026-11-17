import { systemClock, type Clock, type LogData, type LogLevel, type TimerHandle } from '../common/types';
import type { LogEntry, RingLog, RingLogOptions } from './types';
import { MAX_MESSAGE_CHARS, MAX_TAG_CHARS, cleanText, redactData, type RedactOptions } from './redact';

/**
 * Ring-buffer log, kept across app restarts.
 *
 *  - Bounded: at most `capacity` entries (default 500), oldest dropped first; every field is length-capped.
 *  - Redacting: keys and secret-looking values never get in (see redact.ts), on the way in AND when entries are
 *    restored from storage, so an entry written by an older build is cleaned too.
 *  - Persistent: restored from `persistence.load()` on construction; written through `persistence.save()`.
 *    Writes are rate-limited (`persistIntervalMs`): the first entry after a quiet period is written at once, a
 *    burst is coalesced (a trailing write when a `clock` is injected; otherwise the next append or `flush()`),
 *    and an `error` entry is always written immediately so the evidence of a crash survives.
 *  - Never throws: a failing storage adapter, a hostile payload or a throwing subscriber cannot break the caller.
 */

export interface RingLogImplOptions extends RingLogOptions {
  /** Minimum ms between persistence writes. Default 2000. 0 writes on every append. */
  persistIntervalMs?: number;
  /** Minimum ms between subscriber notifications. Default 250. 0 notifies on every append. */
  notifyIntervalMs?: number;
  /** Used for trailing writes/notifications and as the default time source. Without it only leading edges fire. */
  clock?: Clock;
  /** Values (pairing secret, Wi-Fi passphrase) that must never appear in an entry. Read on every append. */
  sensitiveValues?: () => readonly string[];
}

export interface RingLogImpl extends RingLog {
  /** Writes pending entries now (call when the app goes to the background). */
  flush(): void;
  readonly capacity: number;
}

export const DEFAULT_RING_LOG_CAPACITY = 500;
const FORMAT_VERSION = 1;
const LEVELS: readonly LogLevel[] = ['debug', 'info', 'warn', 'error'];

function isLevel(value: unknown): value is LogLevel {
  return LEVELS.some((level) => level === value);
}

export function createRingLog(options: RingLogImplOptions = {}): RingLogImpl {
  const capacity = Math.max(1, Math.floor(options.capacity ?? DEFAULT_RING_LOG_CAPACITY));
  const persistence = options.persistence;
  const clock = options.clock;
  const now = options.now ?? (clock ? () => clock.now() : () => systemClock.now());
  const persistIntervalMs = Math.max(0, options.persistIntervalMs ?? 2000);
  const notifyIntervalMs = Math.max(0, options.notifyIntervalMs ?? 250);
  const sensitiveValues = options.sensitiveValues;

  let entries: LogEntry[] = [];
  const listeners = new Set<() => void>();

  let dirty = false;
  let lastSavedAt = Number.NEGATIVE_INFINITY;
  let saveTimer: TimerHandle | null = null;
  let notifyDirty = false;
  let lastNotifiedAt = Number.NEGATIVE_INFINITY;
  let notifyTimer: TimerHandle | null = null;

  const redactOptions = (): RedactOptions => {
    try {
      return { literals: sensitiveValues ? sensitiveValues() : [] };
    } catch {
      return {};
    }
  };

  const sanitizeEntry = (raw: unknown, redact: RedactOptions): LogEntry | null => {
    if (typeof raw !== 'object' || raw === null) return null;
    const candidate = raw as Partial<Record<keyof LogEntry, unknown>>;
    if (typeof candidate.t !== 'number' || !Number.isFinite(candidate.t)) return null;
    if (!isLevel(candidate.level)) return null;
    if (typeof candidate.tag !== 'string' || typeof candidate.message !== 'string') return null;
    const data = redactData(candidate.data, redact);
    const entry: LogEntry = {
      t: candidate.t,
      level: candidate.level,
      tag: cleanText(candidate.tag, MAX_TAG_CHARS, redact),
      message: cleanText(candidate.message, MAX_MESSAGE_CHARS, redact),
    };
    if (data && Object.keys(data).length > 0) entry.data = Object.freeze(data);
    return Object.freeze(entry);
  };

  // Restore.
  if (persistence) {
    try {
      const serialized = persistence.load();
      if (typeof serialized === 'string' && serialized.length > 0) {
        const parsed: unknown = JSON.parse(serialized);
        const stored = (parsed as { entries?: unknown } | null)?.entries;
        if (Array.isArray(stored)) {
          const redact = redactOptions();
          for (const raw of stored) {
            const entry = sanitizeEntry(raw, redact);
            if (entry) entries.push(entry);
          }
          if (entries.length > capacity) entries = entries.slice(entries.length - capacity);
        }
      }
    } catch {
      // Corrupt or unreadable storage: start with an empty log rather than fail the app.
      entries = [];
    }
  }

  const saveNow = (): void => {
    if (saveTimer !== null && clock) clock.clearTimeout(saveTimer);
    saveTimer = null;
    dirty = false;
    lastSavedAt = now();
    if (!persistence) return;
    try {
      persistence.save(JSON.stringify({ v: FORMAT_VERSION, entries }));
    } catch {
      // A full or broken store must not turn logging into a crash; the in-memory log is still intact.
    }
  };

  const schedulePersist = (urgent: boolean): void => {
    if (!persistence) return;
    dirty = true;
    if (urgent) {
      saveNow();
      return;
    }
    const wait = lastSavedAt + persistIntervalMs - now();
    if (wait <= 0) {
      saveNow();
    } else if (clock && saveTimer === null) {
      saveTimer = clock.setTimeout(() => {
        saveTimer = null;
        if (dirty) saveNow();
      }, wait);
    }
  };

  const notifyNow = (): void => {
    if (notifyTimer !== null && clock) clock.clearTimeout(notifyTimer);
    notifyTimer = null;
    notifyDirty = false;
    lastNotifiedAt = now();
    for (const listener of [...listeners]) {
      try {
        listener();
      } catch {
        // a subscriber's bug is not the log's problem
      }
    }
  };

  const scheduleNotify = (): void => {
    if (listeners.size === 0) return;
    notifyDirty = true;
    const wait = lastNotifiedAt + notifyIntervalMs - now();
    if (wait <= 0 || !clock) {
      notifyNow();
    } else if (notifyTimer === null) {
      notifyTimer = clock.setTimeout(() => {
        notifyTimer = null;
        if (notifyDirty) notifyNow();
      }, wait);
    }
  };

  return {
    capacity,

    log(level: LogLevel, tag: string, message: string, data?: LogData): void {
      try {
        const redact = redactOptions();
        const entry = sanitizeEntry(
          {
            t: now(),
            level: isLevel(level) ? level : 'info',
            tag: String(tag),
            message: String(message),
            data,
          },
          redact,
        );
        if (!entry) return;
        entries.push(entry);
        if (entries.length > capacity) entries.splice(0, entries.length - capacity);
        schedulePersist(entry.level === 'error');
        scheduleNotify();
      } catch {
        // Logging must never throw into the code that is being logged.
      }
    },

    entries(): LogEntry[] {
      return entries.slice();
    },

    clear(): void {
      entries = [];
      schedulePersist(true);
      scheduleNotify();
    },

    subscribe(listener: () => void): () => void {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },

    flush(): void {
      if (dirty) saveNow();
      if (notifyDirty) notifyNow();
    },
  };
}
