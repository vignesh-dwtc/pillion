/// <reference types="node" />
import { describe, expect, it } from '@jest/globals';

import { base64urlDecode, base64urlEncode, base64urlLength } from './base64url';
import { toHex } from './testing/hex';
import { mulberry32, randomInt } from './testing/rng';

function ascii(text: string): Uint8Array {
  return Uint8Array.from(Array.from(text, (c) => c.charCodeAt(0)));
}

describe('base64url encode', () => {
  it.each([
    ['', ''],
    ['f', 'Zg'],
    ['fo', 'Zm8'],
    ['foo', 'Zm9v'],
    ['foob', 'Zm9vYg'],
    ['fooba', 'Zm9vYmE'],
    ['foobar', 'Zm9vYmFy'],
  ])('RFC 4648 vector %j -> %j (no padding)', (plain, encoded) => {
    expect(base64urlEncode(ascii(plain))).toBe(encoded);
    expect(toHex(base64urlDecode(encoded) ?? new Uint8Array())).toBe(toHex(ascii(plain)));
  });

  it('uses the URL-safe alphabet: 62 -> "-", 63 -> "_"', () => {
    expect(base64urlEncode(Uint8Array.of(0xfb, 0xef, 0xbe))).toBe('----');
    expect(base64urlEncode(Uint8Array.of(0xff, 0xff, 0xff))).toBe('____');
    expect(base64urlEncode(Uint8Array.of(0xfb, 0xff))).toBe('-_8');
  });

  it('matches Node for every length 0..300 on seeded random input', () => {
    const next = mulberry32(42);
    for (let length = 0; length <= 300; length++) {
      const bytes = Uint8Array.from({ length }, () => randomInt(next, 0, 255));
      expect(base64urlEncode(bytes)).toBe(Buffer.from(bytes).toString('base64url'));
    }
  });

  it('handles inputs far above the internal flush size', () => {
    const next = mulberry32(7);
    const bytes = Uint8Array.from({ length: 20_000 }, () => randomInt(next, 0, 255));
    const text = base64urlEncode(bytes);
    expect(text).toBe(Buffer.from(bytes).toString('base64url'));
    expect(toHex(base64urlDecode(text) ?? new Uint8Array())).toBe(toHex(bytes));
  });

  it('base64urlLength predicts the encoded length', () => {
    for (let length = 0; length < 100; length++) {
      expect(base64urlLength(length)).toBe(base64urlEncode(new Uint8Array(length)).length);
    }
    expect(base64urlLength(16)).toBe(22); // pair id
    expect(base64urlLength(32)).toBe(43); // secret
  });
});

describe('base64url decode is strict and canonical', () => {
  it.each([
    ['padding', 'Zg=='],
    ['padding on 3 chars', 'Zm8='],
    ['length % 4 == 1', 'Z'],
    ['length % 4 == 1 (longer)', 'Zm9vY'],
    ['non-zero trailing bits (2 chars)', 'Zh'],
    ['non-zero trailing bits (3 chars)', 'Zm9'],
    ['standard alphabet +', 'Zm+v'],
    ['standard alphabet /', 'Zm/v'],
    ['leading space', ' Zg'],
    ['trailing newline', 'Zg\n'],
    ['inner space', 'Z g'],
    ['non-ASCII', 'Zé'],
    ['NUL', 'Zm9v\u0000'],
    ['emoji', 'Zm9v😀'],
    ['dot', 'Zm9.'],
  ])('rejects %s', (_label, text) => {
    expect(base64urlDecode(text)).toBeNull();
  });

  it('rejects non-strings without throwing', () => {
    for (const value of [null, undefined, 5, {}, [], Uint8Array.of(1)]) {
      expect(base64urlDecode(value as unknown as string)).toBeNull();
    }
  });

  it('property: whatever decodes re-encodes to the identical text (exhaustive for 1..3 chars)', () => {
    const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
    let accepted = 0;
    for (const a of alphabet) {
      const one = base64urlDecode(a);
      expect(one).toBeNull(); // a single character can never be canonical
      for (const b of alphabet) {
        const two = base64urlDecode(a + b);
        if (two !== null) {
          accepted += 1;
          expect(base64urlEncode(two)).toBe(a + b);
        }
        for (const c of alphabet) {
          const three = base64urlDecode(a + b + c);
          if (three !== null) {
            accepted += 1;
            expect(base64urlEncode(three)).toBe(a + b + c);
          }
        }
      }
    }
    // 256 one-byte strings and 65536 two-byte strings are the only canonical texts of 2 and 3 characters.
    expect(accepted).toBe(256 + 65536);
  });

  it('property: encode then decode is the identity, decode then encode is the identity (random)', () => {
    const next = mulberry32(99);
    for (let i = 0; i < 500; i++) {
      const bytes = Uint8Array.from({ length: randomInt(next, 0, 80) }, () => randomInt(next, 0, 255));
      const text = base64urlEncode(bytes);
      const back = base64urlDecode(text);
      expect(back).not.toBeNull();
      expect(toHex(back ?? new Uint8Array())).toBe(toHex(bytes));
      expect(base64urlEncode(back ?? new Uint8Array())).toBe(text);
    }
  });

  it('exactly one text per byte string: flipping any character of a valid text either fails or changes the bytes', () => {
    const bytes = Uint8Array.from({ length: 16 }, (_, i) => i * 13 + 1);
    const text = base64urlEncode(bytes);
    const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
    for (let i = 0; i < text.length; i++) {
      for (const replacement of alphabet) {
        if (replacement === text[i]) continue;
        const mutated = text.slice(0, i) + replacement + text.slice(i + 1);
        const decoded = base64urlDecode(mutated);
        if (decoded !== null) expect(toHex(decoded)).not.toBe(toHex(bytes));
      }
    }
  });
});
