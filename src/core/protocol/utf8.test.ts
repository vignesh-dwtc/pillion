/// <reference types="node" />
import { describe, expect, it } from '@jest/globals';

import { utf8Decode, utf8Encode, utf8Length } from './utf8';
import { fromHex, toHex } from './testing/hex';
import { mulberry32, randomInt } from './testing/rng';

describe('utf8Encode', () => {
  it.each([
    ['', ''],
    ['A', '41'],
    ['\u0000', '00'],
    ['\u007f', '7f'],
    ['\u0080', 'c280'],
    ['é', 'c3a9'],
    ['߿', 'dfbf'],
    ['ࠀ', 'e0a080'],
    ['ह', 'e0a4b9'],
    ['€', 'e282ac'],
    ['￿', 'efbfbf'],
    ['\u{10000}', 'f0908080'],
    ['😀', 'f09f9880'],
    ['\u{10ffff}', 'f48fbfbf'],
  ])('%j -> %s', (text, hex) => {
    expect(toHex(utf8Encode(text))).toBe(hex);
    expect(utf8Length(text)).toBe(hex.length / 2);
    expect(utf8Decode(fromHex(hex))).toBe(text);
  });

  it.each([
    ['lone high surrogate', '\ud800', 'efbfbd'],
    ['lone low surrogate', '\udc00', 'efbfbd'],
    ['reversed pair', '\udc00\ud800', 'efbfbdefbfbd'],
    ['high surrogate then letter', '\ud800a', 'efbfbd61'],
    ['letter then lone low', 'a\udfff', '61efbfbd'],
  ])('replaces a %s with U+FFFD like TextEncoder', (_label, text, hex) => {
    expect(toHex(utf8Encode(text))).toBe(hex);
    expect(toHex(utf8Encode(text))).toBe(toHex(new TextEncoder().encode(text)));
    expect(utf8Length(text)).toBe(hex.length / 2);
  });

  it('rejects non-strings', () => {
    expect(() => utf8Encode(5 as unknown as string)).toThrow(TypeError);
  });

  it('agrees with Node on seeded random strings across all planes, lone surrogates included', () => {
    const next = mulberry32(2024);
    const encoder = new TextEncoder();
    for (let i = 0; i < 400; i++) {
      let text = '';
      const units = randomInt(next, 0, 60);
      for (let u = 0; u < units; u++) {
        const kind = next();
        if (kind < 0.4) text += String.fromCharCode(randomInt(next, 0x20, 0x7e));
        else if (kind < 0.6) text += String.fromCharCode(randomInt(next, 0x80, 0x7ff));
        else if (kind < 0.8) text += String.fromCharCode(randomInt(next, 0x800, 0xffff));
        else text += String.fromCodePoint(randomInt(next, 0x10000, 0x10ffff));
      }
      const mine = utf8Encode(text);
      expect(toHex(mine)).toBe(toHex(encoder.encode(text)));
      expect(utf8Length(text)).toBe(mine.length);
    }
  });
});

describe('utf8Decode is strict', () => {
  it.each([
    ['stray continuation byte', '80'],
    ['continuation as 2nd byte of ASCII', '41' + '80'],
    ['overlong NUL (C0 80)', 'c080'],
    ['overlong slash (C0 AF)', 'c0af'],
    ['overlong C1 BF', 'c1bf'],
    ['overlong 3-byte (E0 80 80)', 'e08080'],
    ['overlong 3-byte (E0 9F BF)', 'e09fbf'],
    ['overlong 4-byte (F0 80 80 80)', 'f0808080'],
    ['overlong 4-byte (F0 8F BF BF)', 'f08fbfbf'],
    ['surrogate U+D800', 'eda080'],
    ['surrogate U+DFFF', 'edbfbf'],
    ['above U+10FFFF (F4 90 80 80)', 'f4908080'],
    ['lead F5', 'f5808080'],
    ['lead FF', 'ff'],
    ['lead FE', 'fe'],
    ['truncated 2-byte', 'c3'],
    ['truncated 3-byte', 'e282'],
    ['truncated 4-byte', 'f09f98'],
    ['2-byte lead followed by ASCII', 'c341'],
    ['3-byte lead with bad 3rd byte', 'e28241'],
    ['4-byte lead with bad 4th byte', 'f09f9841'],
  ])('rejects %s', (_label, hex) => {
    expect(utf8Decode(fromHex(hex))).toBeNull();
  });

  it('keeps a BOM (U+FEFF) instead of stripping it: the parser above must see exactly the bytes', () => {
    expect(utf8Decode(fromHex('efbbbf41'))).toBe('﻿' + 'A');
  });

  it('round-trips long strings across the internal flush boundary', () => {
    const text = 'aé€😀'.repeat(3000);
    expect(utf8Decode(utf8Encode(text))).toBe(text);
  });

  it('property: agrees with a fatal TextDecoder on random bytes (both accept or both reject, same text)', () => {
    const next = mulberry32(31337);
    const decoder = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true });
    let accepted = 0;
    for (let i = 0; i < 4000; i++) {
      const length = randomInt(next, 0, 12);
      // Bias toward interesting lead and continuation bytes so valid multi-byte sequences actually occur.
      const bytes = Uint8Array.from({ length }, () => {
        const r = next();
        if (r < 0.25) return randomInt(next, 0x00, 0x7f);
        if (r < 0.45) return randomInt(next, 0x80, 0xbf);
        if (r < 0.75) return randomInt(next, 0xc0, 0xf8);
        return randomInt(next, 0x00, 0xff);
      });
      let expected: string | null;
      try {
        expected = decoder.decode(bytes);
      } catch {
        expected = null;
      }
      const actual = utf8Decode(bytes);
      expect(actual).toBe(expected);
      if (actual !== null) accepted += 1;
    }
    expect(accepted).toBeGreaterThan(200);
  });

  it('property: decode(encode(s)) is the identity for well-formed strings', () => {
    const next = mulberry32(555);
    for (let i = 0; i < 300; i++) {
      let text = '';
      for (let u = 0; u < randomInt(next, 0, 40); u++)
        text += String.fromCodePoint(randomInt(next, 0, 0x10ffff) % 0xd800);
      expect(utf8Decode(utf8Encode(text))).toBe(text);
    }
  });
});
