/**
 * Public surface of src/core/protocol: the frozen contracts plus their implementations.
 * Implementation details (channel.ts, handshake.ts, codec.ts, limits.ts) stay importable by path for tests but are
 * deliberately not re-exported here.
 */
export * from './constants';
export * from './crypto';
export * from './messages';
export * from './secureChannel';

export { base64urlDecode, base64urlEncode, base64urlLength } from './base64url';
export { concatBytes, copyBytes, isBytes, readU32BE, readU64BE, u32ToBytes, u64ToBytes, wipe } from './bytes';
export { utf8Decode, utf8Encode, utf8Length } from './utf8';
export { FRAME_HEADER_BYTES, FrameDecoder, encodeFrame } from './frame';
export { constantTimeEqual, createCryptoProvider } from './noble';
export { establishSecureChannel } from './establish';
export {
  DEFAULT_HANDSHAKE_TIMEOUT_MS,
  MAX_HANDSHAKE_FRAME_BYTES,
  SUPPORTED_PROTOCOL_VERSIONS,
} from './limits';
