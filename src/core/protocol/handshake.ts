import { concatBytes, copyBytes, u64ToBytes, wipe } from './bytes';
import { KDF_LABEL_AUTH, KDF_LABEL_SESSION, MAC_BYTES } from './constants';
import type { CryptoProvider } from './crypto';
import { utf8Encode } from './utf8';

/**
 * Cryptographic steps of the handshake and of per-frame authentication. Pure functions over an injected
 * CryptoProvider; the state machine that sequences them is establish.ts.
 *
 * Wire details the frozen header comment in messages.ts leaves open, fixed here (all are part of protocol v1):
 *  - Every value mixed into a proof or a salt is the RAW BYTES behind the base64url text: pairId 16 bytes, each
 *    nonce 16 bytes. The labels "host" / "guest" are their ASCII bytes. So the host proof input is 4+16+16+16 = 52
 *    bytes and the guest proof input 5+16+16+16 = 53: the two can never be confused, whatever the nonces are.
 *  - authKey   = HKDF-SHA256(ikm = secret, salt = empty, info = KDF_LABEL_AUTH, L = 32).
 *    HKDF treats an empty salt as HashLen zero bytes (RFC 5869); HMAC pads both to the same key block.
 *  - okm       = HKDF-SHA256(ikm = secret, salt = nonceGuest || nonceHost, info = KDF_LABEL_SESSION, L = 64).
 *    okm[0..32)  = key for frames the GUEST sends (guest -> host)
 *    okm[32..64) = key for frames the HOST  sends (host  -> guest)
 *  - tag       = HMAC-SHA256(directionKey, u64be(counter) || jsonBytes); the counter of each direction starts at 0.
 *    The host's `ready` is its counter 0; the guest's first authenticated message is its counter 0.
 */

const LABEL_HOST = utf8Encode('host');
const LABEL_GUEST = utf8Encode('guest');
const INFO_AUTH = utf8Encode(KDF_LABEL_AUTH);
const INFO_SESSION = utf8Encode(KDF_LABEL_SESSION);
const NO_SALT = new Uint8Array(0);
const KEY_BYTES = 32;

export type Role = 'host' | 'guest';

export function deriveAuthKey(crypto: CryptoProvider, secret: Uint8Array): Uint8Array {
  return crypto.hkdfSha256(secret, NO_SALT, INFO_AUTH, KEY_BYTES);
}

/**
 * Proof that `signer` holds the secret, bound to the pair id and both nonces:
 *   host:  HMAC(authKey, "host"  || pairId || nonceGuest || nonceHost)
 *   guest: HMAC(authKey, "guest" || pairId || nonceHost  || nonceGuest)
 */
export function computeProof(
  crypto: CryptoProvider,
  authKey: Uint8Array,
  signer: Role,
  pairId: Uint8Array,
  nonceGuest: Uint8Array,
  nonceHost: Uint8Array,
): Uint8Array {
  const input =
    signer === 'host'
      ? concatBytes(LABEL_HOST, pairId, nonceGuest, nonceHost)
      : concatBytes(LABEL_GUEST, pairId, nonceHost, nonceGuest);
  return crypto.hmacSha256(authKey, input);
}

export interface SessionKeys {
  /** Authenticates frames the guest sends. */
  guestToHost: Uint8Array;
  /** Authenticates frames the host sends. */
  hostToGuest: Uint8Array;
}

export function deriveSessionKeys(
  crypto: CryptoProvider,
  secret: Uint8Array,
  nonceGuest: Uint8Array,
  nonceHost: Uint8Array,
): SessionKeys {
  const okm = crypto.hkdfSha256(secret, concatBytes(nonceGuest, nonceHost), INFO_SESSION, 2 * KEY_BYTES);
  const keys: SessionKeys = {
    guestToHost: copyBytes(okm.subarray(0, KEY_BYTES)),
    hostToGuest: copyBytes(okm.subarray(KEY_BYTES, 2 * KEY_BYTES)),
  };
  wipe(okm);
  return keys;
}

/** HMAC-SHA256(key, u64be(counter) || body). */
export function frameTag(
  crypto: CryptoProvider,
  key: Uint8Array,
  counter: number,
  body: Uint8Array,
): Uint8Array {
  return crypto.hmacSha256(key, concatBytes(u64ToBytes(counter), body));
}

/** Smallest legitimate body is `{}`. */
const MIN_BODY_BYTES = 2;

/** `[32-byte tag][body]`: the payload of a post-handshake frame. */
export function sealFrame(
  crypto: CryptoProvider,
  key: Uint8Array,
  counter: number,
  body: Uint8Array,
): Uint8Array {
  return concatBytes(frameTag(crypto, key, counter, body), body);
}

export type OpenResult = { ok: true; body: Uint8Array } | { ok: false; reason: 'too-short' | 'bad-mac' };

/**
 * Verifies the tag of a post-handshake frame payload against the expected counter, in constant time. The returned
 * body is only ever handed out after the tag verified: nothing is parsed before authentication.
 */
export function openFrame(
  crypto: CryptoProvider,
  key: Uint8Array,
  counter: number,
  payload: Uint8Array,
): OpenResult {
  if (payload.length < MAC_BYTES + MIN_BODY_BYTES) return { ok: false, reason: 'too-short' };
  const body = payload.subarray(MAC_BYTES);
  const expected = frameTag(crypto, key, counter, body);
  const valid = crypto.timingSafeEqual(expected, payload.subarray(0, MAC_BYTES));
  wipe(expected);
  return valid ? { ok: true, body } : { ok: false, reason: 'bad-mac' };
}
