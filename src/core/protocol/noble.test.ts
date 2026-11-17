/// <reference types="node" />
import { describe, expect, it } from '@jest/globals';
import { createHmac, hkdfSync } from 'node:crypto';

import { constantTimeEqual, createCryptoProvider } from './noble';
import { fromHex, toHex } from './testing/hex';
import { mulberry32, randomInt, seededRandomBytes } from './testing/rng';

const crypto = createCryptoProvider(seededRandomBytes(1));

const rep = (byte: number, length: number): Uint8Array => new Uint8Array(length).fill(byte);
const range = (from: number, to: number): Uint8Array =>
  Uint8Array.from({ length: to - from + 1 }, (_, i) => from + i);
const ascii = (text: string): Uint8Array => Uint8Array.from(Array.from(text, (c) => c.charCodeAt(0)));

describe('HMAC-SHA256: RFC 4231 known-answer vectors', () => {
  const vectors: [string, Uint8Array, Uint8Array, string][] = [
    [
      'test case 1',
      rep(0x0b, 20),
      ascii('Hi There'),
      'b0344c61d8db38535ca8afceaf0bf12b881dc200c9833da726e9376c2e32cff7',
    ],
    [
      'test case 2',
      ascii('Jefe'),
      ascii('what do ya want for nothing?'),
      '5bdcc146bf60754e6a042426089575c75a003f089d2739839dec58b964ec3843',
    ],
    [
      'test case 3',
      rep(0xaa, 20),
      rep(0xdd, 50),
      '773ea91e36800e46854db8ebd09181a72959098b3ef8c122d9635514ced565fe',
    ],
    [
      'test case 4',
      range(1, 25),
      rep(0xcd, 50),
      '82558a389a443c0ea4cc819899f2083a85f0faa3e578f8077a2e3ff46729665b',
    ],
    [
      'test case 5 (full tag; the RFC truncates it to 128 bits: a3b61674...555b)',
      rep(0x0c, 20),
      ascii('Test With Truncation'),
      'a3b6167473100ee06e0c796c2955552bfa6f7c0a6a8aef8b93f860aab0cd20c5',
    ],
    [
      'test case 6 (key longer than the block size)',
      rep(0xaa, 131),
      ascii('Test Using Larger Than Block-Size Key - Hash Key First'),
      '60e431591ee0b67f0d8a26aacbf5b77f8e0bc6213728c5140546040f0ee37f54',
    ],
    [
      'test case 7 (long key and long data)',
      rep(0xaa, 131),
      ascii(
        'This is a test using a larger than block-size key and a larger than block-size data. ' +
          'The key needs to be hashed before being used by the HMAC algorithm.',
      ),
      '9b09ffa71b942fcb27635fbcd5b0e944bfdc63644f0713938a7f51535c3a35e2',
    ],
  ];

  it.each(vectors)('%s', (_name, key, data, expected) => {
    expect(toHex(crypto.hmacSha256(key, data))).toBe(expected);
  });

  it('agrees with node:crypto on random keys and messages of every interesting size', () => {
    const next = mulberry32(4231);
    for (const keyLength of [0, 1, 31, 32, 33, 63, 64, 65, 128]) {
      for (const dataLength of [0, 1, 55, 56, 63, 64, 65, 200]) {
        const key = Uint8Array.from({ length: keyLength }, () => randomInt(next, 0, 255));
        const data = Uint8Array.from({ length: dataLength }, () => randomInt(next, 0, 255));
        const oracle = createHmac('sha256', key).update(data).digest('hex');
        expect(toHex(crypto.hmacSha256(key, data))).toBe(oracle);
      }
    }
  });
});

describe('HKDF-SHA256: RFC 5869 known-answer vectors', () => {
  it('test case 1 (basic)', () => {
    const okm = crypto.hkdfSha256(rep(0x0b, 22), range(0, 12), range(0xf0, 0xf9), 42);
    expect(toHex(okm)).toBe(
      '3cb25f25faacd57a90434f64d0362f2a2d2d0a90cf1a5a4c5db02d56ecc4c5bf34007208d5b887185865',
    );
  });

  it('test case 2 (longer inputs and outputs)', () => {
    const okm = crypto.hkdfSha256(range(0x00, 0x4f), range(0x60, 0xaf), range(0xb0, 0xff), 82);
    expect(toHex(okm)).toBe(
      'b11e398dc80327a1c8e7f78c596a49344f012eda2d4efad8a050cc4c19afa97c' +
        '59045a99cac7827271cb41c65e590e09da3275600c2f09b8367793a9aca3db71' +
        'cc30c58179ec3e87c14c01d5c1f3434f1d87',
    );
  });

  it('test case 3 (zero-length salt and info)', () => {
    const okm = crypto.hkdfSha256(rep(0x0b, 22), new Uint8Array(0), new Uint8Array(0), 42);
    expect(toHex(okm)).toBe(
      '8da4e775a563c18f715f802a063c5a31b8a11f5c5ee1879ec3454e5f3c738d2d9d201395faa4b61a96c8',
    );
  });

  it('an empty salt is the same as 32 zero bytes (RFC 5869 section 2.2): the protocol relies on it', () => {
    const ikm = range(1, 32);
    const info = ascii('pillion/v1/auth');
    const empty = crypto.hkdfSha256(ikm, new Uint8Array(0), info, 32);
    const zeros = crypto.hkdfSha256(ikm, new Uint8Array(32), info, 32);
    expect(toHex(empty)).toBe(toHex(zeros));
  });

  it('agrees with node:crypto, including multi-block output and a 64-byte split like the session keys', () => {
    const next = mulberry32(5869);
    for (const length of [1, 16, 32, 33, 64, 65, 255]) {
      const ikm = Uint8Array.from({ length: 32 }, () => randomInt(next, 0, 255));
      const salt = Uint8Array.from({ length: randomInt(next, 0, 40) }, () => randomInt(next, 0, 255));
      const info = Uint8Array.from({ length: randomInt(next, 0, 40) }, () => randomInt(next, 0, 255));
      const oracle = Buffer.from(hkdfSync('sha256', ikm, salt, info, length)).toString('hex');
      expect(toHex(crypto.hkdfSha256(ikm, salt, info, length))).toBe(oracle);
    }
  });

  it('refuses an output longer than 255 * 32 bytes', () => {
    expect(() => crypto.hkdfSha256(rep(1, 32), new Uint8Array(0), new Uint8Array(0), 255 * 32 + 1)).toThrow();
  });
});

describe('timingSafeEqual', () => {
  it('compares content', () => {
    expect(crypto.timingSafeEqual(Uint8Array.of(1, 2, 3), Uint8Array.of(1, 2, 3))).toBe(true);
    expect(crypto.timingSafeEqual(Uint8Array.of(1, 2, 3), Uint8Array.of(1, 2, 4))).toBe(false);
    expect(crypto.timingSafeEqual(Uint8Array.of(0, 2, 3), Uint8Array.of(1, 2, 3))).toBe(false);
    expect(crypto.timingSafeEqual(new Uint8Array(0), new Uint8Array(0))).toBe(true);
  });

  it('treats different lengths as unequal, including a prefix', () => {
    expect(crypto.timingSafeEqual(Uint8Array.of(1, 2, 3), Uint8Array.of(1, 2))).toBe(false);
    expect(crypto.timingSafeEqual(Uint8Array.of(1, 2), Uint8Array.of(1, 2, 3))).toBe(false);
    expect(crypto.timingSafeEqual(new Uint8Array(0), Uint8Array.of(0))).toBe(false);
    expect(crypto.timingSafeEqual(Uint8Array.of(0), new Uint8Array(0))).toBe(false);
  });

  it('detects a difference at every single position of a 32-byte value', () => {
    const base = range(0, 31);
    for (let i = 0; i < 32; i++) {
      for (let bit = 0; bit < 8; bit++) {
        const other = new Uint8Array(base);
        other[i] = (other[i] ?? 0) ^ (1 << bit);
        expect(crypto.timingSafeEqual(base, other)).toBe(false);
      }
    }
  });

  it('has no early exit: every byte of both inputs is read wherever the mismatch is', () => {
    function counting(bytes: Uint8Array): { proxy: Uint8Array; reads: Set<number> } {
      const reads = new Set<number>();
      const proxy = new Proxy(bytes, {
        get(target, property) {
          if (typeof property === 'string' && /^\d+$/.test(property)) reads.add(Number(property));
          // No `receiver`: typed-array accessors such as `length` throw when called on a Proxy.
          return Reflect.get(target, property) as unknown;
        },
      });
      return { proxy, reads };
    }
    const base = range(0, 31);
    for (const mismatchAt of [0, 15, 31]) {
      const other = new Uint8Array(base);
      other[mismatchAt] = (other[mismatchAt] ?? 0) ^ 0xff;
      const left = counting(base);
      const right = counting(other);
      expect(constantTimeEqual(left.proxy, right.proxy)).toBe(false);
      expect(left.reads.size).toBe(32);
      expect(right.reads.size).toBe(32);
    }
  });

  it('rejects non-byte arguments instead of comparing garbage', () => {
    expect(() => constantTimeEqual('abc' as unknown as Uint8Array, Uint8Array.of(1))).toThrow(TypeError);
    expect(() => constantTimeEqual(Uint8Array.of(1), null as unknown as Uint8Array)).toThrow(TypeError);
  });
});

describe('createCryptoProvider(randomBytes)', () => {
  it('passes requested lengths through and returns an independent copy', () => {
    const pool = new Uint8Array(64).fill(0xab);
    const provider = createCryptoProvider((length) => pool.subarray(0, length));
    const out = provider.randomBytes(16);
    expect(out.length).toBe(16);
    out.fill(0);
    expect(pool[0]).toBe(0xab);
    expect(out.buffer.byteLength).toBe(16);
    expect(provider.randomBytes(0).length).toBe(0);
  });

  it('refuses a source that returns the wrong amount or the wrong type', () => {
    expect(() => createCryptoProvider(() => new Uint8Array(8)).randomBytes(16)).toThrow();
    expect(() => createCryptoProvider(() => new Uint8Array(32)).randomBytes(16)).toThrow();
    expect(() => createCryptoProvider(() => [1, 2, 3] as unknown as Uint8Array).randomBytes(3)).toThrow();
    expect(() => createCryptoProvider(() => undefined as unknown as Uint8Array).randomBytes(1)).toThrow();
  });

  it('refuses invalid lengths and a non-function source', () => {
    const provider = createCryptoProvider(seededRandomBytes(1));
    for (const bad of [-1, 1.5, NaN, Infinity]) expect(() => provider.randomBytes(bad)).toThrow(RangeError);
    expect(() => createCryptoProvider(null as unknown as () => Uint8Array)).toThrow(TypeError);
  });

  it('is deterministic for a deterministic source and advances through the stream', () => {
    const a = createCryptoProvider(seededRandomBytes(5));
    const b = createCryptoProvider(seededRandomBytes(5));
    const first = a.randomBytes(16);
    expect(toHex(first)).toBe(toHex(b.randomBytes(16)));
    expect(toHex(a.randomBytes(16))).not.toBe(toHex(first));
  });

  it('exposes the same hash results through the provider as the standalone functions', () => {
    const key = fromHex('000102030405060708090a0b0c0d0e0f');
    expect(toHex(crypto.hmacSha256(key, ascii('abc')))).toBe(
      createHmac('sha256', key).update('abc').digest('hex'),
    );
  });
});
