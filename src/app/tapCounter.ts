/**
 * Counts consecutive taps for the hidden developer entry (7 taps on the version label). Taps further apart than
 * `windowMs` start a new sequence, so an occasional stray tap never adds up over a session. Pure TypeScript with an
 * injectable clock for the unit tests.
 */

export interface TapResult {
  /** Taps in the current sequence (0 right after a trigger). */
  count: number;
  /** Taps still needed to trigger. */
  remaining: number;
  /** True exactly on the tap that completes the sequence. */
  triggered: boolean;
}

export interface TapCounter {
  tap(): TapResult;
  reset(): void;
}

export interface TapCounterOptions {
  required?: number;
  windowMs?: number;
  now?: () => number;
}

export const DEVELOPER_TAPS_REQUIRED = 7;

export function createTapCounter(options: TapCounterOptions = {}): TapCounter {
  const required = options.required ?? DEVELOPER_TAPS_REQUIRED;
  const windowMs = options.windowMs ?? 2000;
  const now = options.now ?? (() => Date.now());
  let count = 0;
  let lastTapAt = Number.NEGATIVE_INFINITY;

  return {
    tap() {
      const t = now();
      if (t - lastTapAt > windowMs) count = 0;
      lastTapAt = t;
      count += 1;
      if (count >= required) {
        count = 0;
        return { count: 0, remaining: required, triggered: true };
      }
      return { count, remaining: required - count, triggered: false };
    },
    reset() {
      count = 0;
      lastTapAt = Number.NEGATIVE_INFINITY;
    },
  };
}
