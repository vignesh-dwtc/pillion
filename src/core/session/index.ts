/**
 * Public surface of src/core/session: the frozen contract plus the state machine and its pure policies.
 * Test doubles live in ./testing (not re-exported here).
 */
export * from './types';
export { createSessionController, type SessionControllerWithStats } from './createSessionController';
export {
  backoffDelayMs,
  baseBackoffMs,
  createReconnectBackoff,
  sanitizeBackoffConfig,
  type BackoffConfig,
  type RandomSource,
  type ReconnectBackoff,
} from './backoff';
export { resolveSessionConfig } from './config';
