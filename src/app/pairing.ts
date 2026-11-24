import {
  PairingError,
  decodePairingString,
  encodePairingString,
  generatePairing,
  payloadFromRecord,
  recordFromPayload,
  validateHostName,
  HOST_NAME_MAX_LENGTH,
} from '../core/pairing';
import type { PairingErrorCode } from '../core/pairing/errors';
import type { PairingRecord, PairingRepository } from '../core/pairing/types';
import { wipe } from '../core/protocol/bytes';
import type { CryptoProvider } from '../core/protocol/crypto';

/**
 * Pairing use cases for the screens, over the core pairing functions and the PairingRepository port. Pure TypeScript
 * with injected dependencies (Jest drives it with an in-memory repository and a seeded random source); the real
 * instance is built in `composition.ts`.
 *
 * Secrets: the pairing string returned by `hostOffer` carries the secret. It exists only to be drawn as a QR (and,
 * in developer mode, copied); callers keep it in component state, never in the app store, a log or an error.
 * Nothing in this module logs, and every error it returns is a fixed kind, never input text.
 */

/** What the host screen needs to draw the pairing plate. */
export interface HostOffer {
  pairId: string;
  /** The name engraved on the plate and carried in the QR. */
  hostName: string;
  /** THE SECRET, encoded. Render as a QR only. Never log, never show as text, never put in the store. */
  pairingString: string;
  createdAt: number;
  /** True when an existing unused offer was shown again instead of generating a new one. */
  reused: boolean;
}

/** Why a scanned or pasted code was not accepted. Fixed kinds: the UI maps each to one friendly sentence. */
export type GuestPairingError =
  /** Not a pairing code of this app (another app's QR, a URL, a typo). */
  | 'not-a-pairing-code'
  /** A pairing code from an older or newer version of the app. */
  | 'unsupported-version'
  /** Our prefix, but the data is damaged or invalid. */
  | 'damaged'
  /** This phone generated that code itself (host and guest must be two phones). */
  | 'own-code'
  /** The code was fine but could not be saved. */
  | 'storage';

export type GuestPairingResult =
  | { ok: true; pairId: string; partnerName: string; alreadyPaired: boolean }
  | { ok: false; error: GuestPairingError };

export interface PairingServiceDeps {
  repository: PairingRepository;
  crypto: CryptoProvider;
  now: () => number;
  /** Called after every change to the stored pairings (the app store re-reads its summaries). */
  onChanged?: () => void | Promise<void>;
}

export interface PairingService {
  /** The host's current unused offer, or a freshly generated and saved one. */
  hostOffer(hostName: string): Promise<HostOffer>;
  /** Replaces every unused host offer with a new one ("New code"). */
  regenerateOffer(hostName: string): Promise<HostOffer>;
  /** Guest: validates a scanned or pasted pairing string and saves the guest record. Never throws. */
  acceptPairingString(text: string): Promise<GuestPairingResult>;
}

/** Characters the pairing payload refuses in a host name (mirrors `validateHostName`). */
function isForbiddenUnit(unit: number): boolean {
  return (
    unit < 0x20 ||
    (unit >= 0x7f && unit <= 0x9f) ||
    unit === 0x2028 ||
    unit === 0x2029 ||
    (unit >= 0x202a && unit <= 0x202e) ||
    (unit >= 0x2066 && unit <= 0x2069) ||
    unit === 0xfffe ||
    unit === 0xffff
  );
}

/**
 * Turns the user's device name into a host name the pairing payload accepts: drops control/formatting characters and
 * lone surrogates, trims, and cuts to HOST_NAME_MAX_LENGTH UTF-16 units without splitting a character. Settings
 * limit the name by code points, the payload by UTF-16 units, so an emoji-heavy name is shortened here.
 */
export function pairingHostName(deviceName: string, fallback: string): string {
  let out = '';
  for (const char of Array.from(deviceName.trim())) {
    const first = char.charCodeAt(0);
    const lone = char.length === 1 && first >= 0xd800 && first <= 0xdfff;
    if (lone || isForbiddenUnit(first)) continue;
    if (out.length + char.length > HOST_NAME_MAX_LENGTH) break;
    out += char;
  }
  out = out.trim();
  try {
    return validateHostName(out);
  } catch {
    return validateHostName(fallback.trim().slice(0, HOST_NAME_MAX_LENGTH).trim());
  }
}

/** A host record nobody has connected to yet: the host only learns the partner's name on the first connection. */
export function isUnusedHostOffer(record: PairingRecord): boolean {
  return record.role === 'host' && record.partnerName === null;
}

function newestFirst(a: PairingRecord, b: PairingRecord): number {
  return b.createdAt - a.createdAt;
}

const ERROR_KIND: Partial<Record<PairingErrorCode, GuestPairingError>> = {
  'bad-prefix': 'not-a-pairing-code',
  'bad-format': 'not-a-pairing-code',
  'too-long': 'not-a-pairing-code',
  'unsupported-version': 'unsupported-version',
};

/** Maps a decode failure to a UI kind. Unknown errors count as damaged codes; the error itself is dropped. */
export function guestErrorFor(error: unknown): GuestPairingError {
  if (error instanceof PairingError) return ERROR_KIND[error.code] ?? 'damaged';
  return 'damaged';
}

export function createPairingService(deps: PairingServiceDeps): PairingService {
  const { repository, crypto, now } = deps;

  const changed = async (): Promise<void> => {
    try {
      await deps.onChanged?.();
    } catch {
      // A failing listener must not turn a saved pairing into a reported failure.
    }
  };

  const offerFrom = (record: PairingRecord, hostName: string, reused: boolean): HostOffer => {
    const payload = payloadFromRecord(record, hostName);
    try {
      return {
        pairId: record.pairId,
        hostName,
        pairingString: encodePairingString(payload),
        createdAt: record.createdAt,
        reused,
      };
    } finally {
      wipe(payload.secret);
    }
  };

  const generateAndSave = async (hostName: string): Promise<HostOffer> => {
    const payload = generatePairing(crypto, hostName);
    try {
      const record = recordFromPayload(payload, 'host', now());
      await repository.save(record);
      return offerFrom(record, payload.hostName, false);
    } finally {
      wipe(payload.secret);
    }
  };

  // One host operation at a time: a double tap on "New code" or a re-render must not create two offers.
  let hostTail: Promise<unknown> = Promise.resolve();
  const serialize = <T>(task: () => Promise<T>): Promise<T> => {
    const run = hostTail.then(task, task);
    hostTail = run.catch(() => undefined);
    return run;
  };

  return {
    hostOffer(rawName) {
      return serialize(async () => {
        const hostName = validateHostName(rawName);
        const existing = (await repository.list()).filter(isUnusedHostOffer).sort(newestFirst)[0];
        if (existing) return offerFrom(existing, hostName, true);
        const offer = await generateAndSave(hostName);
        await changed();
        return offer;
      });
    },

    regenerateOffer(rawName) {
      return serialize(async () => {
        const hostName = validateHostName(rawName);
        const stale = (await repository.list()).filter(isUnusedHostOffer);
        // Save the new offer first, so a failure part-way never leaves the host with no code at all.
        const offer = await generateAndSave(hostName);
        for (const record of stale) await repository.remove(record.pairId);
        await changed();
        return offer;
      });
    },

    async acceptPairingString(text) {
      let payload;
      try {
        payload = decodePairingString(typeof text === 'string' ? text.trim() : text);
      } catch (error) {
        return { ok: false, error: guestErrorFor(error) };
      }
      try {
        const existing = await repository.get(payload.pairId);
        if (existing?.role === 'host') return { ok: false, error: 'own-code' };
        if (existing?.role === 'guest') {
          return { ok: true, pairId: payload.pairId, partnerName: payload.hostName, alreadyPaired: true };
        }
        await repository.save(recordFromPayload(payload, 'guest', now()));
      } catch {
        return { ok: false, error: 'storage' };
      } finally {
        wipe(payload.secret);
      }
      await changed();
      return { ok: true, pairId: payload.pairId, partnerName: payload.hostName, alreadyPaired: false };
    },
  };
}

/**
 * Debounces camera scans. The scanner reports the same QR many times per second: while one code is being handled
 * every scan is ignored, and after a rejected code the same text is ignored for `repeatMs`, so one bad QR in view
 * shows its error once instead of flickering. A different code is handled right away.
 */
export interface ScanGate {
  /** True when this scan should be handled now; the caller must call `release` when done (unless it leaves). */
  tryEnter(data: string): boolean;
  release(): void;
}

export function createScanGate(options: { now: () => number; repeatMs?: number }): ScanGate {
  const repeatMs = options.repeatMs ?? 3000;
  let busy = false;
  let last: { data: string; at: number } | null = null;
  return {
    tryEnter(data) {
      if (busy) return false;
      const at = options.now();
      if (last && last.data === data && at - last.at < repeatMs) return false;
      busy = true;
      last = { data, at };
      return true;
    },
    release() {
      busy = false;
      if (last) last = { data: last.data, at: options.now() };
    },
  };
}
