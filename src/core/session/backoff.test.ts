import { DEFAULT_SESSION_CONFIG } from './types';
import {
  MIN_BACKOFF_MS,
  backoffDelayMs,
  baseBackoffMs,
  createReconnectBackoff,
  sanitizeBackoffConfig,
  type BackoffConfig,
} from './backoff';
import { createSeededUnit } from './testing/seededRandom';

const DEFAULTS = DEFAULT_SESSION_CONFIG.backoff;
const noJitter: BackoffConfig = { initialMs: 500, maxMs: 3000, factor: 1.7, jitter: 0 };

describe('baseBackoffMs', () => {
  it('grows exponentially from initialMs and stops at maxMs', () => {
    const delays = [0, 1, 2, 3, 4, 5, 6].map((n) => baseBackoffMs(noJitter, n));
    expect(delays[0]).toBe(500);
    expect(delays[1]).toBeCloseTo(850, 6);
    expect(delays[2]).toBeCloseTo(1445, 6);
    expect(delays[3]).toBeCloseTo(2456.5, 6);
    expect(delays.slice(4)).toEqual([3000, 3000, 3000]);
  });

  it('never exceeds maxMs, even for absurd attempt numbers (Infinity from the power)', () => {
    expect(baseBackoffMs(noJitter, 10_000)).toBe(3000);
    expect(baseBackoffMs(noJitter, Number.MAX_SAFE_INTEGER)).toBe(3000);
  });

  it('treats a negative or fractional attempt like the nearest valid one', () => {
    expect(baseBackoffMs(noJitter, -5)).toBe(500);
    expect(baseBackoffMs(noJitter, 0.9)).toBe(500);
  });
});

describe('backoffDelayMs', () => {
  it('is jittered symmetrically around the base: +/- jitter at the extremes, the base at 0.5', () => {
    const config: BackoffConfig = { initialMs: 1000, maxMs: 60_000, factor: 2, jitter: 0.2 };
    expect(backoffDelayMs(config, 0, () => 0)).toBe(800);
    expect(backoffDelayMs(config, 0, () => 0.5)).toBe(1000);
    expect(backoffDelayMs(config, 0, () => 0.999999)).toBeGreaterThanOrEqual(1199);
    expect(backoffDelayMs(config, 0, () => 0.999999)).toBeLessThanOrEqual(1200);
    expect(backoffDelayMs(config, 3, () => 0)).toBe(6400);
  });

  it('never exceeds maxMs after jitter either, so the configured maximum is a real maximum', () => {
    for (let n = 0; n < 40; n += 1) {
      expect(backoffDelayMs(DEFAULTS, n, () => 0.999999)).toBeLessThanOrEqual(DEFAULTS.maxMs);
    }
  });

  it('at the cap the delay stays within [max * (1 - jitter), max]', () => {
    const random = createSeededUnit(7);
    for (let i = 0; i < 500; i += 1) {
      const delay = backoffDelayMs(DEFAULTS, 50, random);
      expect(delay).toBeGreaterThanOrEqual(Math.floor(DEFAULTS.maxMs * (1 - DEFAULTS.jitter)));
      expect(delay).toBeLessThanOrEqual(DEFAULTS.maxMs);
    }
  });

  it('with zero jitter is exactly the base, rounded to a whole millisecond', () => {
    expect(backoffDelayMs(noJitter, 1, () => 0.123)).toBe(850);
    expect(backoffDelayMs(noJitter, 2, () => 0.9)).toBe(1445);
    // 500 * 1.7^3 = 2456.5 up to floating point noise: rounded to a whole millisecond either way.
    expect(Math.abs(backoffDelayMs(noJitter, 3, () => 0.9) - 2456.5)).toBeLessThanOrEqual(0.5);
  });

  it('survives a broken random source (NaN, out of range) without ever returning NaN or a negative', () => {
    for (const bad of [Number.NaN, -3, 7, Number.POSITIVE_INFINITY]) {
      const delay = backoffDelayMs(DEFAULTS, 2, () => bad);
      expect(Number.isFinite(delay)).toBe(true);
      expect(delay).toBeGreaterThanOrEqual(MIN_BACKOFF_MS);
      expect(delay).toBeLessThanOrEqual(DEFAULTS.maxMs);
    }
  });
});

describe('createReconnectBackoff', () => {
  it('walks up the schedule and counts attempts', () => {
    const backoff = createReconnectBackoff(noJitter, () => 0.5);
    expect(backoff.attempts).toBe(0);
    const delays = Array.from({ length: 6 }, () => backoff.next());
    expect(delays.slice(0, 3)).toEqual([500, 850, 1445]);
    expect(Math.abs((delays[3] ?? 0) - 2456.5)).toBeLessThanOrEqual(0.5);
    expect(delays.slice(4)).toEqual([3000, 3000]);
    expect(backoff.attempts).toBe(6);
  });

  it('reset() starts the next outage from the beginning', () => {
    const backoff = createReconnectBackoff(noJitter, () => 0.5);
    backoff.next();
    backoff.next();
    backoff.next();
    backoff.reset();
    expect(backoff.attempts).toBe(0);
    expect(backoff.next()).toBe(500);
  });

  it('is deterministic under a seeded random source', () => {
    const run = (seed: number): number[] => {
      const backoff = createReconnectBackoff(DEFAULTS, createSeededUnit(seed));
      return Array.from({ length: 30 }, () => backoff.next());
    };
    expect(run(42)).toEqual(run(42));
    expect(run(42)).not.toEqual(run(43));
  });

  it('never gives up: a hundred thousand consecutive failures still yield a finite delay within bounds', () => {
    const backoff = createReconnectBackoff(DEFAULTS, createSeededUnit(1));
    let min = Number.POSITIVE_INFINITY;
    let max = 0;
    for (let i = 0; i < 100_000; i += 1) {
      const delay = backoff.next();
      expect(Number.isFinite(delay)).toBe(true);
      min = Math.min(min, delay);
      max = Math.max(max, delay);
    }
    expect(min).toBeGreaterThanOrEqual(MIN_BACKOFF_MS);
    expect(max).toBeLessThanOrEqual(DEFAULTS.maxMs);
    expect(backoff.attempts).toBe(100_000);
  });

  it('the jittered schedule is non-decreasing on average and bounded in the steady state', () => {
    const backoff = createReconnectBackoff(DEFAULTS, createSeededUnit(5));
    const first = backoff.next();
    for (let i = 0; i < 20; i += 1) backoff.next();
    const steady = Array.from({ length: 200 }, () => backoff.next());
    const mean = steady.reduce((a, b) => a + b, 0) / steady.length;
    expect(first).toBeLessThan(mean);
    expect(mean).toBeGreaterThan(DEFAULTS.maxMs * 0.85);
    expect(mean).toBeLessThanOrEqual(DEFAULTS.maxMs);
  });
});

describe('sanitizeBackoffConfig', () => {
  it('keeps a sane config unchanged', () => {
    expect(sanitizeBackoffConfig(DEFAULTS, DEFAULTS)).toEqual(DEFAULTS);
  });

  it('repairs NaN, negatives, a factor below 1, jitter outside 0..1 and max below initial', () => {
    const fixed = sanitizeBackoffConfig(
      { initialMs: Number.NaN, maxMs: -1, factor: 0.5, jitter: 7 },
      DEFAULTS,
    );
    expect(fixed.initialMs).toBe(DEFAULTS.initialMs);
    expect(fixed.maxMs).toBe(DEFAULTS.maxMs);
    expect(fixed.factor).toBe(DEFAULTS.factor);
    expect(fixed.jitter).toBe(1);
    const inverted = sanitizeBackoffConfig({ initialMs: 5000, maxMs: 1000, factor: 2, jitter: -1 }, DEFAULTS);
    expect(inverted.maxMs).toBe(5000);
    expect(inverted.jitter).toBe(0);
  });

  it('never allows a zero delay: a retry loop must always yield to the clock', () => {
    const fixed = sanitizeBackoffConfig(
      { initialMs: 0, maxMs: 0, factor: 2, jitter: 0 },
      { ...DEFAULTS, initialMs: 0, maxMs: 0 },
    );
    expect(fixed.initialMs).toBeGreaterThanOrEqual(MIN_BACKOFF_MS);
    expect(backoffDelayMs(fixed, 0, () => 0.5)).toBeGreaterThanOrEqual(MIN_BACKOFF_MS);
  });
});
