import type { SessionConfig } from './types';

/**
 * Reconnect policy: exponential backoff with jitter. Pure: the only inputs are the config, the attempt number and
 * an injected random source, so the same seed always yields the same delays.
 *
 *   base(n)  = min(maxMs, initialMs * factor^n)                    n = 0 for the first retry
 *   delay(n) = clamp(base(n) * (1 + jitter * (2 * r - 1)), 1, maxMs)   r = random() in [0, 1)
 *
 * There is deliberately no attempt limit: while a ride is active the session never gives up (brief, M2). The
 * delay at the cap is therefore also the steady-state retry period of a long outage. Jitter is symmetric
 * (+/- jitter * base) but the result is clamped to maxMs so the configured maximum is a real maximum.
 */

export type BackoffConfig = SessionConfig['backoff'];

/** Smallest delay ever returned: a retry loop must always yield to the event loop / clock. */
export const MIN_BACKOFF_MS = 1;

export type RandomSource = () => number;

function finitePositive(value: number, fallback: number): number {
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

/** Repairs a nonsensical config (NaN, negative, max < initial, factor < 1, jitter outside 0..1). */
export function sanitizeBackoffConfig(config: BackoffConfig, defaults: BackoffConfig): BackoffConfig {
  const initialMs = Math.max(MIN_BACKOFF_MS, finitePositive(config.initialMs, defaults.initialMs));
  const maxMs = Math.max(initialMs, finitePositive(config.maxMs, defaults.maxMs));
  const factor = Number.isFinite(config.factor) && config.factor >= 1 ? config.factor : defaults.factor;
  const jitter = Number.isFinite(config.jitter) ? Math.min(1, Math.max(0, config.jitter)) : defaults.jitter;
  return { initialMs, maxMs, factor, jitter };
}

/** Jitter-free delay before retry number `attempt` (0 = first retry). */
export function baseBackoffMs(config: BackoffConfig, attempt: number): number {
  const n = Math.max(0, Math.floor(attempt));
  const grown = config.initialMs * Math.pow(config.factor, n);
  // Infinity (huge n) and NaN both collapse to the cap.
  return Number.isFinite(grown) ? Math.min(config.maxMs, grown) : config.maxMs;
}

/** Delay before retry number `attempt` (0 = first retry), jittered with `random` (a value in [0, 1)). */
export function backoffDelayMs(config: BackoffConfig, attempt: number, random: RandomSource): number {
  const base = baseBackoffMs(config, attempt);
  const raw = random();
  const r = Number.isFinite(raw) ? Math.min(0.999999999, Math.max(0, raw)) : 0.5;
  const jittered = base * (1 + config.jitter * (2 * r - 1));
  return Math.min(config.maxMs, Math.max(MIN_BACKOFF_MS, Math.round(jittered)));
}

export interface ReconnectBackoff {
  /** Delay before the next retry; advances the attempt counter. Never throws, never signals "give up". */
  next(): number;
  /** Call on success: the next outage starts again from `initialMs`. */
  reset(): void;
  /** Retries handed out since the last reset. */
  readonly attempts: number;
}

export function createReconnectBackoff(config: BackoffConfig, random: RandomSource): ReconnectBackoff {
  let attempts = 0;
  return {
    next(): number {
      const delay = backoffDelayMs(config, attempts, random);
      attempts += 1;
      return delay;
    },
    reset(): void {
      attempts = 0;
    },
    get attempts(): number {
      return attempts;
    },
  };
}
