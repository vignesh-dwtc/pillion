import { sanitizeBackoffConfig } from './backoff';
import { DEFAULT_SESSION_CONFIG, type SessionConfig } from './types';

/** Timings that are not part of the frozen `SessionConfig` but must still be deterministic and testable. */
export const INTERNAL_TIMINGS = {
  /** Slack added to a transport's own deadline before the session's watchdog gives up on a call that never settles. */
  watchdogGraceMs: 1_000,
  /** How long end() waits for the `bye` frame to be handed to the link. */
  byeTimeoutMs: 1_000,
  /** How long a single close()/stop()/dispose() call may take before the release path moves on. */
  releaseTimeoutMs: 3_000,
  /** The start sequence's native calls (audio route, service, microphone) must not hang the ride silently. */
  startStepTimeoutMs: 20_000,
  /** How long a shutdown cue may play before the audio route is released. */
  cueGraceMs: 800,
  /** How often the battery level is re-read while the ride is active. */
  batteryPollMs: 60_000,
} as const;

function positive(value: number | undefined, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : fallback;
}

/** Merges a partial override over the defaults and repairs values that would break the state machine. */
export function resolveSessionConfig(partial?: Partial<SessionConfig>): SessionConfig {
  const d = DEFAULT_SESSION_CONFIG;
  const heartbeatIntervalMs = positive(partial?.heartbeatIntervalMs, d.heartbeatIntervalMs);
  let heartbeatTimeoutMs = positive(partial?.heartbeatTimeoutMs, d.heartbeatTimeoutMs);
  // A timeout shorter than two intervals would declare a healthy link dead.
  if (heartbeatTimeoutMs < heartbeatIntervalMs * 2) heartbeatTimeoutMs = heartbeatIntervalMs * 3;
  return {
    linkOpenTimeoutMs: positive(partial?.linkOpenTimeoutMs, d.linkOpenTimeoutMs),
    handshakeTimeoutMs: positive(partial?.handshakeTimeoutMs, d.handshakeTimeoutMs),
    negotiationTimeoutMs: positive(partial?.negotiationTimeoutMs, d.negotiationTimeoutMs),
    heartbeatIntervalMs,
    heartbeatTimeoutMs,
    backoff: sanitizeBackoffConfig({ ...d.backoff, ...partial?.backoff }, d.backoff),
  };
}
