import { INTERNAL_TIMINGS, resolveSessionConfig } from './config';
import { DEFAULT_SESSION_CONFIG } from './types';

describe('resolveSessionConfig', () => {
  it('returns the defaults when nothing is given', () => {
    expect(resolveSessionConfig()).toEqual(DEFAULT_SESSION_CONFIG);
    expect(resolveSessionConfig({})).toEqual(DEFAULT_SESSION_CONFIG);
  });

  it('merges overrides over the defaults, including a partial backoff', () => {
    const config = resolveSessionConfig({
      heartbeatIntervalMs: 1000,
      heartbeatTimeoutMs: 4000,
      backoff: { initialMs: 100, maxMs: 800, factor: 2, jitter: 0 },
    });
    expect(config.heartbeatIntervalMs).toBe(1000);
    expect(config.heartbeatTimeoutMs).toBe(4000);
    expect(config.backoff).toEqual({ initialMs: 100, maxMs: 800, factor: 2, jitter: 0 });
    expect(config.linkOpenTimeoutMs).toBe(DEFAULT_SESSION_CONFIG.linkOpenTimeoutMs);
    const partialBackoff = resolveSessionConfig({ backoff: { maxMs: 5000 } as never });
    expect(partialBackoff.backoff.initialMs).toBe(DEFAULT_SESSION_CONFIG.backoff.initialMs);
    expect(partialBackoff.backoff.maxMs).toBe(5000);
  });

  it('repairs non-positive and non-finite durations', () => {
    const config = resolveSessionConfig({
      linkOpenTimeoutMs: -1,
      handshakeTimeoutMs: Number.NaN,
      negotiationTimeoutMs: 0,
      heartbeatIntervalMs: Number.POSITIVE_INFINITY,
    });
    expect(config.linkOpenTimeoutMs).toBe(DEFAULT_SESSION_CONFIG.linkOpenTimeoutMs);
    expect(config.handshakeTimeoutMs).toBe(DEFAULT_SESSION_CONFIG.handshakeTimeoutMs);
    expect(config.negotiationTimeoutMs).toBe(DEFAULT_SESSION_CONFIG.negotiationTimeoutMs);
    expect(config.heartbeatIntervalMs).toBe(DEFAULT_SESSION_CONFIG.heartbeatIntervalMs);
  });

  it('never lets the heartbeat timeout drop below two intervals (a healthy link must not be declared dead)', () => {
    const config = resolveSessionConfig({ heartbeatIntervalMs: 2000, heartbeatTimeoutMs: 2500 });
    expect(config.heartbeatTimeoutMs).toBe(6000);
    expect(
      resolveSessionConfig({ heartbeatIntervalMs: 2000, heartbeatTimeoutMs: 4000 }).heartbeatTimeoutMs,
    ).toBe(4000);
  });

  it('keeps the internal timings positive and the watchdog slack small', () => {
    for (const value of Object.values(INTERNAL_TIMINGS)) expect(value).toBeGreaterThan(0);
    expect(INTERNAL_TIMINGS.watchdogGraceMs).toBeLessThan(DEFAULT_SESSION_CONFIG.handshakeTimeoutMs);
  });
});
