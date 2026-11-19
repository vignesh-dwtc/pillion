import type { CryptoProvider, RandomBytesSource } from '../../protocol/crypto';
import { createCryptoProvider } from '../../protocol/noble';

/** mulberry32: a tiny, well-distributed, fully deterministic 32-bit generator. NOT for security. */
export function createSeededUnit(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function createSeededRandomBytes(seed: number): RandomBytesSource {
  const unit = createSeededUnit(seed);
  return (length) => {
    const out = new Uint8Array(length);
    for (let i = 0; i < length; i += 1) out[i] = Math.floor(unit() * 256);
    return out;
  };
}

/** The real HMAC/HKDF provider with reproducible randomness: nonces and backoff jitter are the same on every run. */
export function createSeededCrypto(seed: number): CryptoProvider {
  return createCryptoProvider(createSeededRandomBytes(seed));
}
