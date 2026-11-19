/**
 * Cryptography port. CONTRACT: owned by the lead.
 * `core-protocol` implements `createCryptoProvider` with @noble/hashes (pure TypeScript, no native code),
 * so the same code runs in Jest (Node), Hermes and the browser. Random bytes are injected because
 * src/core must not import expo-crypto / react-native: the app supplies them at the composition root
 * (expo-crypto on native, crypto.getRandomValues on web, node:crypto in tests).
 */

export type RandomBytesSource = (length: number) => Uint8Array;

export interface CryptoProvider {
  randomBytes(length: number): Uint8Array;
  hmacSha256(key: Uint8Array, data: Uint8Array): Uint8Array;
  hkdfSha256(ikm: Uint8Array, salt: Uint8Array, info: Uint8Array, length: number): Uint8Array;
  /** Constant-time comparison. Never use === / Buffer.compare on MACs or proofs. */
  timingSafeEqual(a: Uint8Array, b: Uint8Array): boolean;
}
