/// <reference types="node" />
import { describe, expect, it } from '@jest/globals';
import { runInNewContext } from 'node:vm';

import { concatBytes, copyBytes, isBytes, readU32BE, readU64BE, u32ToBytes, u64ToBytes, wipe } from './bytes';
import { toHex } from './testing/hex';

describe('concatBytes / copyBytes / wipe', () => {
  it('concatenates in order into a fresh array', () => {
    const a = Uint8Array.of(1, 2);
    const b = Uint8Array.of();
    const c = Uint8Array.of(3);
    const out = concatBytes(a, b, c);
    expect(toHex(out)).toBe('010203');
    out[0] = 9;
    expect(a[0]).toBe(1);
    expect(concatBytes().length).toBe(0);
  });

  it('copyBytes returns an independent array even for Node Buffers (whose slice() aliases)', () => {
    const source = Buffer.from([1, 2, 3, 4]);
    const copy = copyBytes(source.subarray(1, 3));
    expect(toHex(copy)).toBe('0203');
    source[1] = 99;
    expect(copy[0]).toBe(2);
    expect(copy.buffer.byteLength).toBe(2);
  });

  it('wipe zeroes arrays and tolerates null / undefined', () => {
    const a = Uint8Array.of(1, 2, 3);
    const b = Uint8Array.of(4);
    wipe(a, null, undefined, b);
    expect(toHex(a)).toBe('000000');
    expect(toHex(b)).toBe('00');
  });
});

describe('u32', () => {
  it.each([
    [0, '00000000'],
    [1, '00000001'],
    [255, '000000ff'],
    [256, '00000100'],
    [0x01020304, '01020304'],
    [65536, '00010000'],
    [0x7fffffff, '7fffffff'],
    [0x80000000, '80000000'],
    [0xffffffff, 'ffffffff'],
  ])('encodes %i big-endian', (value, hex) => {
    expect(toHex(u32ToBytes(value))).toBe(hex);
    expect(readU32BE(u32ToBytes(value))).toBe(value);
  });

  it.each([-1, 0x100000000, 1.5, NaN, Infinity, -0.5])('rejects out-of-range value %p', (value) => {
    expect(() => u32ToBytes(value)).toThrow(RangeError);
  });

  it('reads at an offset and refuses to read past the end', () => {
    const bytes = Uint8Array.of(0xaa, 0x00, 0x00, 0x01, 0x00);
    expect(readU32BE(bytes, 1)).toBe(256);
    expect(() => readU32BE(bytes, 2)).toThrow(RangeError);
    expect(() => readU32BE(bytes, -1)).toThrow(RangeError);
    expect(() => readU32BE(bytes, 0.5)).toThrow(RangeError);
    expect(() => readU32BE(new Uint8Array(3))).toThrow(RangeError);
  });
});

describe('u64', () => {
  it.each([
    [0, '0000000000000000'],
    [1, '0000000000000001'],
    [0xffffffff, '00000000ffffffff'],
    [0x100000000, '0000000100000000'],
    [0x100000001, '0000000100000001'],
    [2 ** 40 + 5, '0000010000000005'],
    [Number.MAX_SAFE_INTEGER, '001fffffffffffff'],
  ])('encodes %i big-endian and reads it back', (value, hex) => {
    expect(toHex(u64ToBytes(value))).toBe(hex);
    expect(readU64BE(u64ToBytes(value))).toBe(value);
  });

  it.each([-1, 2 ** 53, 1.5, NaN, Infinity])('rejects %p', (value) => {
    expect(() => u64ToBytes(value)).toThrow(RangeError);
  });

  it('refuses to read a value that does not fit a safe integer', () => {
    expect(() => readU64BE(Uint8Array.of(0, 0x20, 0, 0, 0, 0, 0, 0))).toThrow(RangeError);
    expect(() => readU64BE(new Uint8Array(7))).toThrow(RangeError);
  });

  it('counters increase strictly: every value in a range encodes differently', () => {
    const seen = new Set<string>();
    for (let counter = 0; counter < 70000; counter += 7) seen.add(toHex(u64ToBytes(counter)));
    expect(seen.size).toBe(Math.ceil(70000 / 7));
  });
});

describe('isBytes', () => {
  it('accepts Uint8Array, Buffer and a Uint8Array from another realm', () => {
    expect(isBytes(new Uint8Array(2))).toBe(true);
    expect(isBytes(Buffer.alloc(2))).toBe(true);
    const foreign: unknown = runInNewContext('new Uint8Array(4)');
    expect(foreign instanceof Uint8Array).toBe(false); // a different realm: instanceof alone would fail
    expect(isBytes(foreign)).toBe(true);
  });

  it('rejects everything else', () => {
    expect(isBytes(new Uint16Array(2))).toBe(false);
    expect(isBytes(new Uint8ClampedArray(2))).toBe(false);
    expect(isBytes(new ArrayBuffer(2))).toBe(false);
    expect(isBytes([1, 2, 3])).toBe(false);
    expect(isBytes('abc')).toBe(false);
    expect(isBytes(null)).toBe(false);
    expect(isBytes(undefined)).toBe(false);
    expect(isBytes({ length: 2, 0: 1, 1: 2 })).toBe(false);
    expect(isBytes({ constructor: { name: 'Uint8Array' }, BYTES_PER_ELEMENT: 1 })).toBe(false);
  });
});
