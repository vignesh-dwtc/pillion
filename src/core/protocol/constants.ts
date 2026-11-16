/**
 * Wire-level constants. CONTRACT: owned by the lead; `core-protocol` may propose changes.
 * Timing values for the session (heartbeats, backoff) live in src/core/session (SessionConfig), not here.
 */

export const PROTOCOL_VERSION = 1;

/** Hard cap on a single frame payload. Larger frames are a protocol violation: close the channel. */
export const MAX_FRAME_BYTES = 64 * 1024;

export const SECRET_BYTES = 32;
export const PAIR_ID_BYTES = 16;
export const NONCE_BYTES = 16;
export const MAC_BYTES = 32;

/** HKDF `info` labels. Changing any of these is a protocol break: bump PROTOCOL_VERSION. */
export const KDF_LABEL_AUTH = 'pillion/v1/auth';
export const KDF_LABEL_SESSION = 'pillion/v1/session';
