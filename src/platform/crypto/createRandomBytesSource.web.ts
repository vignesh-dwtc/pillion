import type { RandomBytesSource } from '../../core/protocol/crypto';

/** WebCrypto refuses more than 65536 bytes per getRandomValues call. */
const MAX_CHUNK = 65536;

/**
 * Web twin of createRandomBytesSource: the browser's `crypto.getRandomValues` (a CSPRNG in every supported browser,
 * available on insecure origins too). Throws when WebCrypto is missing instead of falling back to Math.random.
 */
export function createRandomBytesSource(): RandomBytesSource {
  return (length: number): Uint8Array => {
    const webCrypto = (globalThis as { crypto?: Crypto }).crypto;
    if (!webCrypto || typeof webCrypto.getRandomValues !== 'function') {
      throw new Error('crypto.getRandomValues is not available');
    }
    const bytes = new Uint8Array(length);
    for (let offset = 0; offset < length; offset += MAX_CHUNK) {
      webCrypto.getRandomValues(bytes.subarray(offset, Math.min(length, offset + MAX_CHUNK)));
    }
    return bytes;
  };
}
