import type { CryptoProvider } from '../protocol/crypto';
import { base64urlEncode } from '../protocol/base64url';
import { PAIR_ID_BYTES, SECRET_BYTES } from '../protocol/constants';
import { WIFI_DIRECT_NAME_PREFIX } from './config';
import { PairingError } from './errors';
import type { PairingPayload } from './types';
import {
  PAIRING_VERSION,
  validateHostName,
  validateNetworkName,
  validatePairingPayload,
  validatePassphrase,
} from './validate';

const ALNUM = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
/** Largest multiple of 62 that fits a byte: bytes at or above it are rejected so every character is equally likely. */
const ACCEPT_BELOW = 248;

export const NETWORK_SUFFIX_LENGTH = 8;
export const PASSPHRASE_LENGTH = 24;

function draw(crypto: CryptoProvider, length: number): Uint8Array {
  const bytes = crypto.randomBytes(length);
  if (!(bytes instanceof Uint8Array) || bytes.length !== length) {
    throw new PairingError('rng-failure', 'random source returned the wrong amount of data');
  }
  return bytes;
}

/** A random-looking check: a constant stream (all zero / all identical) means the source is broken. */
function assertNotConstant(bytes: Uint8Array): void {
  const first = bytes[0];
  if (bytes.every((b) => b === first)) throw new PairingError('rng-failure', 'random source looks broken');
}

/** Uniform random alphanumeric string by rejection sampling (no modulo bias). */
function randomAlnum(crypto: CryptoProvider, length: number): string {
  let out = '';
  let attempts = 0;
  while (out.length < length) {
    if (++attempts > 64) throw new PairingError('rng-failure', 'random source rejected too often');
    const batch = draw(crypto, (length - out.length) * 2);
    for (let i = 0; i < batch.length && out.length < length; i++) {
      const b = batch[i] as number;
      if (b < ACCEPT_BELOW) out += ALNUM.charAt(b % 62);
    }
  }
  return out;
}

/**
 * Creates a fresh pairing for the host. `hostName` is trimmed, then strictly validated. All randomness comes from
 * `crypto.randomBytes`. Nothing is logged.
 */
export function generatePairing(crypto: CryptoProvider, hostName: string): PairingPayload {
  const name = validateHostName(typeof hostName === 'string' ? hostName.trim() : hostName);
  const pairIdBytes = draw(crypto, PAIR_ID_BYTES);
  const secret = draw(crypto, SECRET_BYTES);
  assertNotConstant(pairIdBytes);
  assertNotConstant(secret);
  const payload: PairingPayload = {
    version: PAIRING_VERSION,
    pairId: base64urlEncode(pairIdBytes),
    secret,
    hostName: name,
    wifiDirect: {
      networkName: validateNetworkName(WIFI_DIRECT_NAME_PREFIX + randomAlnum(crypto, NETWORK_SUFFIX_LENGTH)),
      passphrase: validatePassphrase(randomAlnum(crypto, PASSPHRASE_LENGTH)),
    },
  };
  validatePairingPayload(payload);
  return payload;
}
