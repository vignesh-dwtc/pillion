/// <reference types="node" />
import { randomBytes as nodeRandomBytes } from 'node:crypto';

import type { RandomBytesSource } from '../crypto';

/** Test helpers only. Deterministic generators make failures reproducible: always print the seed, never secrets. */

/** mulberry32: small, fast, good enough for fuzzing. Returns floats in [0, 1). */
export function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Integer in [min, max] inclusive. */
export function randomInt(next: () => number, min: number, max: number): number {
  return min + Math.floor(next() * (max - min + 1));
}

/** A deterministic byte stream: the same seed always yields the same bytes, call after call. */
export function seededRandomBytes(seed: number): RandomBytesSource {
  const next = mulberry32(seed);
  return (length) => {
    const out = new Uint8Array(length);
    for (let i = 0; i < length; i++) out[i] = Math.floor(next() * 256);
    return out;
  };
}

/** Real randomness (node:crypto) as a plain Uint8Array. */
export const systemRandomBytes: RandomBytesSource = (length) => new Uint8Array(nodeRandomBytes(length));

/** Returns each queued value in order, then repeats nothing: for scripting exact random draws. */
export function scriptedRandomBytes(draws: Uint8Array[]): RandomBytesSource {
  let index = 0;
  return (length) => {
    const draw = draws[index];
    index += 1;
    if (draw === undefined) throw new Error('scripted random source exhausted');
    if (draw.length !== length) throw new Error(`scripted draw ${index - 1} has the wrong length`);
    return new Uint8Array(draw);
  };
}
