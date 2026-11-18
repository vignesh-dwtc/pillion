import { PROTOCOL_VERSION } from './constants';

/**
 * Implementation-level limits of the protocol layer. These are NOT part of the frozen wire contract
 * (constants.ts): each is stricter than, or an implementation choice within, what messages.ts specifies.
 */

/** Versions this implementation speaks. The host answers `unsupported-version` to anything else. */
export const SUPPORTED_PROTOCOL_VERSIONS: readonly number[] = [PROTOCOL_VERSION];

/**
 * Largest frame accepted BEFORE the peer has proven the pairing secret. Every handshake message is far smaller
 * (about 150 bytes); an unauthenticated peer on the same network gets no business making us buffer more.
 */
export const MAX_HANDSHAKE_FRAME_BYTES = 1024;

/** Default handshake deadline (SecureChannelOptions.handshakeTimeoutMs). */
export const DEFAULT_HANDSHAKE_TIMEOUT_MS = 5000;

/**
 * Messages that arrive before the first `onMessage` listener subscribes (for example an SDP offer that shares a TCP
 * chunk with `ready`) are queued up to this many; one more closes the channel (fail closed: a silently dropped
 * message would be undetectable because its MAC counter is already consumed). In practice the session
 * subscribes within one microtask of establishSecureChannel resolving, so the queue holds a handful at most.
 */
export const MAX_BACKLOG_MESSAGES = 256;

/** Longest `name` accepted in a peer-state message (UTF-16 code units). The UI truncates for display. */
export const MAX_PEER_NAME_LENGTH = 256;

/** Longest string accepted for short identifier fields (sdpMid). */
export const MAX_SHORT_STRING_LENGTH = 256;

/** Most entries accepted in `reject.supportedVersions`. */
export const MAX_SUPPORTED_VERSIONS_LISTED = 16;
