/// <reference types="node" />
import { describe, expect, it } from '@jest/globals';
import { createHmac, hkdfSync } from 'node:crypto';

import { concatBytes, u64ToBytes } from './bytes';
import { KDF_LABEL_AUTH, KDF_LABEL_SESSION, MAC_BYTES } from './constants';
import { computeProof, deriveAuthKey, deriveSessionKeys, frameTag, openFrame, sealFrame } from './handshake';
import { createCryptoProvider } from './noble';
import { bytesEqual, fromHex, pattern, toHex } from './testing/hex';
import { mulberry32, randomInt, seededRandomBytes } from './testing/rng';
import { utf8Encode } from './utf8';

const crypto = createCryptoProvider(seededRandomBytes(1));

// Fixed, obviously fake fixture values.
const SECRET = pattern(32);
const PAIR_ID = pattern(16, 0x40);
const NONCE_GUEST = pattern(16, 0x80);
const NONCE_HOST = pattern(16, 0xc0);
const READY = utf8Encode('{"type":"ready"}');

// Golden values computed once with node:crypto (not with noble, not with this code). A change here is a wire
// protocol break and must come with a PROTOCOL_VERSION bump (see DECISIONS D-023).
const GOLDEN = {
  authKey: 'cebff3232903f719c1172910946d019d29901d65a3ffac5c9b8a652badbfe4b2',
  hostProof: 'efc44eb426323a581bbb3c5403bcb706e26113e9a386ea465f724910255df9b2',
  guestProof: 'deff9c60b03ec7105a031170ddd3906f8566de9022b14002d0d0c8928293910c',
  guestToHost: '450468fee9aea376011ad375f585ff71f211a6877f0588f8dc17cd4291f9aee9',
  hostToGuest: '970041003486d400ebe8c06a0b9521d190f8ac4a34cc483be54f9a6f830cd93f',
  tagHostToGuest0: '227e839d6ab1dbc004d80d737b2900e0aaad0cb25c3f3bfdb6cb382056e4f452',
  tagHostToGuest1: '376cf9948af36bb96dfc04560baf7cb91b33aa5bc780ef20aff4077babc155ff',
  tagGuestToHost0: 'f3502dcebdd87de8714f5367cd4720d274caaed6dd7768aa2441c32e0cfe090a',
  tagHostToGuestAt2p32: '21ad4a945edb3ca7fd3e05497acd09015331cf35d7484286363158b4bfa49919',
};

const hmac = (key: Uint8Array, data: Uint8Array): Uint8Array =>
  new Uint8Array(createHmac('sha256', key).update(data).digest());

describe('constants the KDF depends on (D-023: protocol identifiers, not display names)', () => {
  it('labels are the frozen v1 strings', () => {
    expect(KDF_LABEL_AUTH).toBe('pillion/v1/auth');
    expect(KDF_LABEL_SESSION).toBe('pillion/v1/session');
  });
});

describe('deriveAuthKey', () => {
  it('matches the pinned golden value and an independent node:crypto derivation', () => {
    const key = deriveAuthKey(crypto, SECRET);
    expect(toHex(key)).toBe(GOLDEN.authKey);
    const oracle = new Uint8Array(hkdfSync('sha256', SECRET, new Uint8Array(0), KDF_LABEL_AUTH, 32));
    expect(bytesEqual(key, oracle)).toBe(true);
  });

  it('depends on the secret and nothing else', () => {
    const other = new Uint8Array(SECRET);
    other[31] = (other[31] ?? 0) ^ 1;
    expect(bytesEqual(deriveAuthKey(crypto, SECRET), deriveAuthKey(crypto, other))).toBe(false);
    expect(bytesEqual(deriveAuthKey(crypto, SECRET), deriveAuthKey(crypto, new Uint8Array(SECRET)))).toBe(
      true,
    );
  });
});

describe('computeProof', () => {
  const authKey = deriveAuthKey(crypto, SECRET);

  it('host proof = HMAC(authKey, "host" || pairId || nonceG || nonceH)', () => {
    const proof = computeProof(crypto, authKey, 'host', PAIR_ID, NONCE_GUEST, NONCE_HOST);
    expect(toHex(proof)).toBe(GOLDEN.hostProof);
    const input = concatBytes(utf8Encode('host'), PAIR_ID, NONCE_GUEST, NONCE_HOST);
    expect(bytesEqual(proof, hmac(authKey, input))).toBe(true);
    expect(input.length).toBe(52);
  });

  it('guest proof = HMAC(authKey, "guest" || pairId || nonceH || nonceG)', () => {
    const proof = computeProof(crypto, authKey, 'guest', PAIR_ID, NONCE_GUEST, NONCE_HOST);
    expect(toHex(proof)).toBe(GOLDEN.guestProof);
    const input = concatBytes(utf8Encode('guest'), PAIR_ID, NONCE_HOST, NONCE_GUEST);
    expect(bytesEqual(proof, hmac(authKey, input))).toBe(true);
    expect(input.length).toBe(53);
  });

  it('reflection: the host proof is never the guest proof, for any nonce choice', () => {
    const next = mulberry32(1);
    for (let i = 0; i < 200; i++) {
      const nonceA = Uint8Array.from({ length: 16 }, () => randomInt(next, 0, 255));
      const nonceB = Uint8Array.from({ length: 16 }, () => randomInt(next, 0, 255));
      const host = computeProof(crypto, authKey, 'host', PAIR_ID, nonceA, nonceB);
      // Every way an attacker could replay a host proof as a guest proof:
      for (const [g, h] of [
        [nonceA, nonceB],
        [nonceB, nonceA],
        [nonceA, nonceA],
        [nonceB, nonceB],
      ] as const) {
        expect(bytesEqual(host, computeProof(crypto, authKey, 'guest', PAIR_ID, g, h))).toBe(false);
      }
    }
    // Even with identical nonces on both sides the two roles differ.
    const same = pattern(16, 7);
    expect(
      bytesEqual(
        computeProof(crypto, authKey, 'host', PAIR_ID, same, same),
        computeProof(crypto, authKey, 'guest', PAIR_ID, same, same),
      ),
    ).toBe(false);
  });

  it('the two roles hash inputs of different length, so no collision between them is possible', () => {
    const seen: number[] = [];
    const spying = {
      ...crypto,
      hmacSha256: (key: Uint8Array, data: Uint8Array) => {
        seen.push(data.length);
        return crypto.hmacSha256(key, data);
      },
    };
    computeProof(spying, authKey, 'host', PAIR_ID, NONCE_GUEST, NONCE_HOST);
    computeProof(spying, authKey, 'guest', PAIR_ID, NONCE_GUEST, NONCE_HOST);
    expect(seen).toEqual([52, 53]);
  });

  it('binds every input: flipping any single bit of pair id, either nonce or the key changes the proof', () => {
    const base = computeProof(crypto, authKey, 'host', PAIR_ID, NONCE_GUEST, NONCE_HOST);
    const flip = (bytes: Uint8Array, index: number, bit: number): Uint8Array => {
      const copy = new Uint8Array(bytes);
      copy[index] = (copy[index] ?? 0) ^ (1 << bit);
      return copy;
    };
    for (let i = 0; i < 16; i++) {
      for (const bit of [0, 7]) {
        expect(
          bytesEqual(
            base,
            computeProof(crypto, authKey, 'host', flip(PAIR_ID, i, bit), NONCE_GUEST, NONCE_HOST),
          ),
        ).toBe(false);
        expect(
          bytesEqual(
            base,
            computeProof(crypto, authKey, 'host', PAIR_ID, flip(NONCE_GUEST, i, bit), NONCE_HOST),
          ),
        ).toBe(false);
        expect(
          bytesEqual(
            base,
            computeProof(crypto, authKey, 'host', PAIR_ID, NONCE_GUEST, flip(NONCE_HOST, i, bit)),
          ),
        ).toBe(false);
      }
    }
    expect(
      bytesEqual(base, computeProof(crypto, flip(authKey, 0, 0), 'host', PAIR_ID, NONCE_GUEST, NONCE_HOST)),
    ).toBe(false);
  });

  it('a different secret gives a different proof (wrong-secret detection rests on this)', () => {
    const otherKey = deriveAuthKey(crypto, pattern(32, 1));
    expect(
      bytesEqual(
        computeProof(crypto, authKey, 'host', PAIR_ID, NONCE_GUEST, NONCE_HOST),
        computeProof(crypto, otherKey, 'host', PAIR_ID, NONCE_GUEST, NONCE_HOST),
      ),
    ).toBe(false);
  });
});

describe('deriveSessionKeys', () => {
  it('matches the pinned golden values and node:crypto: okm[0..32) guest->host, okm[32..64) host->guest', () => {
    const keys = deriveSessionKeys(crypto, SECRET, NONCE_GUEST, NONCE_HOST);
    expect(toHex(keys.guestToHost)).toBe(GOLDEN.guestToHost);
    expect(toHex(keys.hostToGuest)).toBe(GOLDEN.hostToGuest);
    const okm = new Uint8Array(
      hkdfSync('sha256', SECRET, concatBytes(NONCE_GUEST, NONCE_HOST), KDF_LABEL_SESSION, 64),
    );
    expect(bytesEqual(keys.guestToHost, okm.subarray(0, 32))).toBe(true);
    expect(bytesEqual(keys.hostToGuest, okm.subarray(32))).toBe(true);
  });

  it('gives the two directions different keys', () => {
    const keys = deriveSessionKeys(crypto, SECRET, NONCE_GUEST, NONCE_HOST);
    expect(bytesEqual(keys.guestToHost, keys.hostToGuest)).toBe(false);
  });

  it('is independent from the auth key (different label)', () => {
    const keys = deriveSessionKeys(crypto, SECRET, NONCE_GUEST, NONCE_HOST);
    const auth = deriveAuthKey(crypto, SECRET);
    expect(bytesEqual(keys.guestToHost, auth)).toBe(false);
    expect(bytesEqual(keys.hostToGuest, auth)).toBe(false);
  });

  it('depends on the secret and on both nonces, and their ORDER matters', () => {
    const base = deriveSessionKeys(crypto, SECRET, NONCE_GUEST, NONCE_HOST);
    const same = (a: typeof base, b: typeof base): boolean =>
      bytesEqual(a.guestToHost, b.guestToHost) || bytesEqual(a.hostToGuest, b.hostToGuest);
    expect(same(base, deriveSessionKeys(crypto, pattern(32, 1), NONCE_GUEST, NONCE_HOST))).toBe(false);
    expect(same(base, deriveSessionKeys(crypto, SECRET, pattern(16, 1), NONCE_HOST))).toBe(false);
    expect(same(base, deriveSessionKeys(crypto, SECRET, NONCE_GUEST, pattern(16, 1)))).toBe(false);
    expect(same(base, deriveSessionKeys(crypto, SECRET, NONCE_HOST, NONCE_GUEST))).toBe(false);
  });

  it('returns arrays the caller owns: wiping them does not disturb the next derivation', () => {
    const a = deriveSessionKeys(crypto, SECRET, NONCE_GUEST, NONCE_HOST);
    a.guestToHost.fill(0);
    a.hostToGuest.fill(0);
    const b = deriveSessionKeys(crypto, SECRET, NONCE_GUEST, NONCE_HOST);
    expect(toHex(b.guestToHost)).toBe(GOLDEN.guestToHost);
    expect(a.guestToHost.buffer.byteLength).toBe(32);
  });
});

describe('frame tags', () => {
  const keys = deriveSessionKeys(crypto, SECRET, NONCE_GUEST, NONCE_HOST);

  it('tag = HMAC(key, u64be(counter) || body), pinned and cross-checked', () => {
    expect(toHex(frameTag(crypto, keys.hostToGuest, 0, READY))).toBe(GOLDEN.tagHostToGuest0);
    expect(toHex(frameTag(crypto, keys.hostToGuest, 1, READY))).toBe(GOLDEN.tagHostToGuest1);
    expect(toHex(frameTag(crypto, keys.guestToHost, 0, READY))).toBe(GOLDEN.tagGuestToHost0);
    expect(toHex(frameTag(crypto, keys.hostToGuest, 2 ** 32, READY))).toBe(GOLDEN.tagHostToGuestAt2p32);
    const oracle = hmac(keys.hostToGuest, concatBytes(u64ToBytes(5), READY));
    expect(bytesEqual(frameTag(crypto, keys.hostToGuest, 5, READY), oracle)).toBe(true);
  });

  it('the counter, the direction and the body all change the tag', () => {
    const tags = new Set([
      toHex(frameTag(crypto, keys.hostToGuest, 0, READY)),
      toHex(frameTag(crypto, keys.hostToGuest, 1, READY)),
      toHex(frameTag(crypto, keys.guestToHost, 0, READY)),
      toHex(frameTag(crypto, keys.hostToGuest, 0, utf8Encode('{"type":"bye","reason":"error"}'))),
    ]);
    expect(tags.size).toBe(4);
  });

  it('seal then open round-trips only for the right key and the right counter', () => {
    const frame = sealFrame(crypto, keys.hostToGuest, 3, READY);
    expect(frame.length).toBe(MAC_BYTES + READY.length);
    const ok = openFrame(crypto, keys.hostToGuest, 3, frame);
    expect(ok.ok && bytesEqual(ok.body, READY)).toBe(true);
    for (const counter of [0, 2, 4, 2 ** 32 + 3]) {
      expect(openFrame(crypto, keys.hostToGuest, counter, frame)).toEqual({ ok: false, reason: 'bad-mac' });
    }
    expect(openFrame(crypto, keys.guestToHost, 3, frame)).toEqual({ ok: false, reason: 'bad-mac' });
  });

  it('every single-bit flip anywhere in a sealed frame fails verification', () => {
    const frame = sealFrame(crypto, keys.guestToHost, 0, READY);
    for (let byte = 0; byte < frame.length; byte++) {
      for (let bit = 0; bit < 8; bit++) {
        const flipped = new Uint8Array(frame);
        flipped[byte] = (flipped[byte] ?? 0) ^ (1 << bit);
        expect(openFrame(crypto, keys.guestToHost, 0, flipped)).toEqual({ ok: false, reason: 'bad-mac' });
      }
    }
  });

  it('truncation and extension fail; frames too short for a tag are reported as such', () => {
    const frame = sealFrame(crypto, keys.guestToHost, 0, READY);
    expect(openFrame(crypto, keys.guestToHost, 0, frame.subarray(0, frame.length - 1))).toEqual({
      ok: false,
      reason: 'bad-mac',
    });
    expect(openFrame(crypto, keys.guestToHost, 0, concatBytes(frame, Uint8Array.of(0)))).toEqual({
      ok: false,
      reason: 'bad-mac',
    });
    expect(openFrame(crypto, keys.guestToHost, 0, new Uint8Array(0))).toEqual({
      ok: false,
      reason: 'too-short',
    });
    expect(openFrame(crypto, keys.guestToHost, 0, new Uint8Array(MAC_BYTES))).toEqual({
      ok: false,
      reason: 'too-short',
    });
    expect(openFrame(crypto, keys.guestToHost, 0, new Uint8Array(MAC_BYTES + 1))).toEqual({
      ok: false,
      reason: 'too-short',
    });
    expect(openFrame(crypto, keys.guestToHost, 0, new Uint8Array(MAC_BYTES + 2)).ok).toBe(false);
  });

  it('verification goes through the provider timingSafeEqual (a plain === would not)', () => {
    const frame = sealFrame(crypto, keys.guestToHost, 0, READY);
    let calls = 0;
    const spying = {
      ...crypto,
      timingSafeEqual: (a: Uint8Array, b: Uint8Array) => {
        calls += 1;
        return crypto.timingSafeEqual(a, b);
      },
    };
    expect(openFrame(spying, keys.guestToHost, 0, frame).ok).toBe(true);
    expect(calls).toBe(1);
    const alwaysEqual = { ...crypto, timingSafeEqual: () => true };
    const garbage = concatBytes(new Uint8Array(MAC_BYTES), READY);
    expect(openFrame(alwaysEqual, keys.guestToHost, 0, garbage).ok).toBe(true); // proves the provider decides
    expect(openFrame(crypto, keys.guestToHost, 0, garbage).ok).toBe(false);
  });

  it('an all-zero tag is not valid for any small counter', () => {
    const forged = concatBytes(new Uint8Array(MAC_BYTES), READY);
    for (let counter = 0; counter < 50; counter++) {
      expect(openFrame(crypto, keys.guestToHost, counter, forged).ok).toBe(false);
    }
  });
});

describe('hex helpers used by the tests', () => {
  it('round-trip', () => {
    expect(toHex(fromHex('00ff10'))).toBe('00ff10');
  });
});
