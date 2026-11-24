/**
 * Ride clock: a core `Clock` whose timers run on a native Handler thread of the IntercomRideService module
 * (`scheduleTimer` / `cancelTimer` / `onTimer`), not on React Native's JS timers.
 *
 * Why: in React Native 0.88 (bridgeless too) `setTimeout` fires from a Choreographer frame callback, and that callback
 * returns early while the React host is paused (screen off). During a ride with both screens off the session's
 * heartbeat, watchdog and reconnect backoff would freeze, then all fire in one frame on unlock (watchdog before any
 * pong). Native events still reach JS with the screen off, so a timer that fires natively and arrives as an event keeps
 * ticking. The ride service's partial wake lock keeps the CPU (and so the Handler's uptime clock) running.
 *
 * Contract: one-shot timers; `clearTimeout` of an unknown or already fired handle is a no-op; a cleared timer never
 * runs, even if its native event is already in flight (the callback map decides). If the native side refuses a timer
 * (its bounded queue is full) or throws, that timer falls back to the JS `setTimeout`, so nothing is ever lost.
 *
 * Compiles and is unit-tested with a fake native module (NativeRideClock.test.ts); untested on device.
 */
import type { Clock, TimerHandle } from '../../core/common/types';

export interface RideTimerEvents {
  onTimer(event: { id: number }): void;
}

/** The part of the IntercomRideService native module the clock uses. */
export interface RideTimerNativeModule {
  /** Sync. Returns false when the native queue refused the timer. */
  scheduleTimer(id: number, delayMs: number): boolean;
  /** Sync. Unknown ids are ignored. */
  cancelTimer(id: number): void;
  addListener<E extends keyof RideTimerEvents>(
    eventName: E,
    listener: RideTimerEvents[E],
  ): { remove(): void };
}

/** True when [candidate] has the timer functions (a native build older than this wrapper does not). */
export function hasRideTimers(candidate: unknown): candidate is RideTimerNativeModule {
  const module = candidate as Partial<RideTimerNativeModule> | null | undefined;
  return (
    typeof module?.scheduleTimer === 'function' &&
    typeof module.cancelTimer === 'function' &&
    typeof module.addListener === 'function'
  );
}

/** Native ids are Kotlin Ints: keep them positive 31-bit and wrap around. */
const MAX_ID = 0x7fffffff;

type Handle = { kind: 'native'; id: number } | { kind: 'js'; handle: ReturnType<typeof setTimeout> };

export function createNativeRideClock(native: RideTimerNativeModule, now: () => number = Date.now): Clock {
  const callbacks = new Map<number, () => void>();
  let nextId = 0;

  native.addListener('onTimer', (event) => {
    const fn = callbacks.get(event.id);
    if (fn === undefined) return; // cleared (or replaced) after the native side fired it
    callbacks.delete(event.id);
    fn();
  });

  function allocateId(): number {
    do {
      nextId = nextId >= MAX_ID ? 1 : nextId + 1;
    } while (callbacks.has(nextId));
    return nextId;
  }

  return {
    now,
    setTimeout(fn: () => void, ms: number): TimerHandle {
      const id = allocateId();
      callbacks.set(id, fn);
      let accepted = false;
      try {
        accepted = native.scheduleTimer(id, Number.isFinite(ms) ? Math.max(0, ms) : 0);
      } catch {
        accepted = false;
      }
      if (accepted) return { kind: 'native', id } satisfies Handle;
      callbacks.delete(id);
      return { kind: 'js', handle: setTimeout(fn, ms) } satisfies Handle;
    },
    clearTimeout(handle: TimerHandle): void {
      const h = handle as Handle | null | undefined;
      if (h === null || h === undefined || typeof h !== 'object') return;
      if (h.kind === 'js') {
        clearTimeout(h.handle);
        return;
      }
      if (h.kind !== 'native' || !callbacks.delete(h.id)) return;
      try {
        native.cancelTimer(h.id);
      } catch {
        // The callback is gone already; a late native event is ignored.
      }
    },
  };
}
