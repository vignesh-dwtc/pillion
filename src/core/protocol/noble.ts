import { hkdf } from '@noble/hashes/hkdf.js';
import { hmac } from '@noble/hashes/hmac.js';
import { sha256 } from '@noble/hashes/sha2.js';

import { isBytes } from './bytes';
import type { CryptoProvider, RandomBytesSource } from './crypto';

/**
 * CryptoProvider over @noble/hashes (pure TypeScript, audited, no native code), so the same code runs in Jest,
 * Hermes and the browser. Verified against the installed package (2.4.0): the root module throws on import, so
 * submodules are imported with their `.js` suffix as the package `exports` map requires.
 *
 * Randomness is injected: expo-crypto on native, crypto.getRandomValues on web, node:crypto in tests.
 */

/**
 * Constant-time equality for equal-length inputs: the loop always visits every byte and combines differences with
 * OR instead of returning at the first mismatch. Inputs of different length are unequal; lengths are not secret.
 */
export function constantTimeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (!isBytes(a) || !isBytes(b)) throw new TypeError('Uint8Array expected');
  let difference = a.length ^ b.length;
  const length = Math.max(a.length, b.length);
  for (let i = 0; i < length; i++) {
    difference |= (a[i] ?? 0) ^ (b[i] ?? 0);
  }
  return difference === 0;
}

export function createCryptoProvider(randomBytes: RandomBytesSource): CryptoProvider {
  if (typeof randomBytes !== 'function') throw new TypeError('randomBytes source must be a function');
  return {
    randomBytes(length: number): Uint8Array {
      if (!Number.isInteger(length) || length < 0) throw new RangeError('invalid random length');
      const bytes = randomBytes(length);
      // A broken source (wrong type or short read) must never silently weaken a nonce or a secret.
      if (!isBytes(bytes) || bytes.length !== length)
        throw new Error('random source returned the wrong amount');
      return new Uint8Array(bytes); // own copy: the source may hand out a view into a shared pool
    },
    hmacSha256(key: Uint8Array, data: Uint8Array): Uint8Array {
      return hmac(sha256, key, data);
    },
    hkdfSha256(ikm: Uint8Array, salt: Uint8Array, info: Uint8Array, length: number): Uint8Array {
      return hkdf(sha256, ikm, salt, info, length);
    },
    timingSafeEqual: constantTimeEqual,
  };
}
