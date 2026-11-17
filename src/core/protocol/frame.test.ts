import { describe, expect, it } from '@jest/globals';

import { u32ToBytes } from './bytes';
import { MAX_FRAME_BYTES } from './constants';
import { FRAME_HEADER_BYTES, FrameDecoder, encodeFrame } from './frame';
import { ProtocolError } from './secureChannel';
import { bytesEqual, toHex } from './testing/hex';
import { mulberry32, randomInt } from './testing/rng';

function payloadOf(next: () => number, length: number): Uint8Array {
  return Uint8Array.from({ length }, () => randomInt(next, 0, 255));
}

function streamOf(frames: Uint8Array[]): Uint8Array {
  const parts = frames.map((frame) => encodeFrame(frame));
  const out = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

/** Feeds chunks and pulls after each push, like the secure channel does. */
function decodeChunks(chunks: Uint8Array[], decoder = new FrameDecoder()): Uint8Array[] {
  const frames: Uint8Array[] = [];
  for (const chunk of chunks) {
    decoder.push(chunk);
    for (let frame = decoder.next(); frame !== null; frame = decoder.next()) frames.push(frame);
  }
  return frames;
}

function cutAt(stream: Uint8Array, cuts: number[]): Uint8Array[] {
  const points = [0, ...cuts, stream.length];
  const chunks: Uint8Array[] = [];
  for (let i = 0; i + 1 < points.length; i++) {
    const from = points[i] ?? 0;
    const to = points[i + 1] ?? 0;
    if (to > from) chunks.push(stream.slice(from, to));
  }
  return chunks;
}

function sameFrames(a: Uint8Array[], b: Uint8Array[]): boolean {
  return a.length === b.length && a.every((frame, index) => bytesEqual(frame, b[index] ?? new Uint8Array()));
}

function errorOf(action: () => unknown): ProtocolError {
  try {
    action();
  } catch (error) {
    if (error instanceof ProtocolError) return error;
    throw error;
  }
  throw new Error('expected a ProtocolError');
}

describe('encodeFrame', () => {
  it('prefixes a 4-byte big-endian length', () => {
    expect(toHex(encodeFrame(Uint8Array.of(0xaa, 0xbb, 0xcc)))).toBe('00000003aabbcc');
    expect(FRAME_HEADER_BYTES).toBe(4);
  });

  it('accepts exactly MAX_FRAME_BYTES and rejects one more with frame-too-large', () => {
    const atLimit = encodeFrame(new Uint8Array(MAX_FRAME_BYTES));
    expect(atLimit.length).toBe(MAX_FRAME_BYTES + 4);
    expect(toHex(atLimit.subarray(0, 4))).toBe('00010000');
    expect(errorOf(() => encodeFrame(new Uint8Array(MAX_FRAME_BYTES + 1))).code).toBe('frame-too-large');
  });

  it('refuses an empty payload (nothing legitimate is empty) and non-bytes', () => {
    expect(errorOf(() => encodeFrame(new Uint8Array(0))).code).toBe('malformed-frame');
    expect(() => encodeFrame('abc' as unknown as Uint8Array)).toThrow(TypeError);
  });

  it('honours a tighter explicit limit', () => {
    expect(errorOf(() => encodeFrame(new Uint8Array(11), 10)).code).toBe('frame-too-large');
    expect(encodeFrame(new Uint8Array(10), 10).length).toBe(14);
  });
});

describe('FrameDecoder: reassembly', () => {
  it('decodes a single frame delivered whole', () => {
    expect(toHex(decodeChunks([encodeFrame(Uint8Array.of(1, 2, 3))])[0] ?? new Uint8Array())).toBe('010203');
  });

  it('splits one chunk that carries several frames', () => {
    const frames = [Uint8Array.of(1), Uint8Array.of(2, 3), Uint8Array.of(4, 5, 6)];
    const out = decodeChunks([streamOf(frames)]);
    expect(sameFrames(out, frames)).toBe(true);
  });

  it('reassembles when the header itself is split across chunks (every split point)', () => {
    const frames = [Uint8Array.of(9, 8, 7, 6, 5)];
    const stream = streamOf(frames);
    for (let cut = 1; cut < stream.length; cut++) {
      expect(sameFrames(decodeChunks(cutAt(stream, [cut])), frames)).toBe(true);
    }
  });

  it('reassembles from one byte per chunk', () => {
    const next = mulberry32(3);
    const frames = [payloadOf(next, 1), payloadOf(next, 300), payloadOf(next, 17)];
    const stream = streamOf(frames);
    const bytes = Array.from(stream, (byte) => Uint8Array.of(byte));
    expect(sameFrames(decodeChunks(bytes), frames)).toBe(true);
  });

  it('fuzz: random frames cut at random places always decode to the original frames', () => {
    const next = mulberry32(20260101);
    for (let round = 0; round < 300; round++) {
      const frames: Uint8Array[] = [];
      for (let i = 0; i < randomInt(next, 1, 8); i++) {
        const size = next() < 0.05 ? randomInt(next, 4000, 20000) : randomInt(next, 1, 400);
        frames.push(payloadOf(next, size));
      }
      const stream = streamOf(frames);
      const cuts: number[] = [];
      for (let c = 0; c < randomInt(next, 0, 25); c++) cuts.push(randomInt(next, 0, stream.length));
      cuts.sort((a, b) => a - b);
      expect(sameFrames(decodeChunks(cutAt(stream, cuts)), frames)).toBe(true);
    }
  });

  it('fuzz: pushing everything first and pulling afterwards gives the same frames', () => {
    const next = mulberry32(8);
    for (let round = 0; round < 100; round++) {
      const frames = Array.from({ length: randomInt(next, 1, 6) }, () =>
        payloadOf(next, randomInt(next, 1, 500)),
      );
      const stream = streamOf(frames);
      const decoder = new FrameDecoder();
      for (const chunk of cutAt(
        stream,
        [randomInt(next, 0, stream.length), randomInt(next, 0, stream.length)].sort((a, b) => a - b),
      )) {
        decoder.push(chunk);
      }
      const out: Uint8Array[] = [];
      for (let frame = decoder.next(); frame !== null; frame = decoder.next()) out.push(frame);
      expect(sameFrames(out, frames)).toBe(true);
      expect(decoder.bufferedBytes).toBe(0);
    }
  });

  it('decodes a MAX_FRAME_BYTES frame fed one byte at a time without quadratic behaviour', () => {
    const next = mulberry32(5);
    const frame = payloadOf(next, MAX_FRAME_BYTES);
    const stream = streamOf([frame]);
    const decoder = new FrameDecoder();
    const started = Date.now();
    let out: Uint8Array | null = null;
    for (const byte of stream) {
      decoder.push(Uint8Array.of(byte));
      out = decoder.next() ?? out;
    }
    expect(out !== null && bytesEqual(out, frame)).toBe(true);
    expect(Date.now() - started).toBeLessThan(3000);
  });
});

describe('FrameDecoder: truncated streams', () => {
  it('for every prefix of a stream it emits exactly the complete frames and buffers the rest', () => {
    const next = mulberry32(11);
    const frames = [payloadOf(next, 5), payloadOf(next, 1), payloadOf(next, 30)];
    const stream = streamOf(frames);
    const ends: number[] = [];
    let offset = 0;
    for (const frame of frames) {
      offset += 4 + frame.length;
      ends.push(offset);
    }
    for (let prefix = 0; prefix <= stream.length; prefix++) {
      const decoder = new FrameDecoder();
      decoder.push(stream.subarray(0, prefix));
      const out: Uint8Array[] = [];
      for (let frame = decoder.next(); frame !== null; frame = decoder.next()) out.push(frame);
      const complete = ends.filter((end) => end <= prefix).length;
      expect(out.length).toBe(complete);
      expect(sameFrames(out, frames.slice(0, complete))).toBe(true);
      const consumed = complete === 0 ? 0 : (ends[complete - 1] ?? 0);
      expect(decoder.bufferedBytes).toBe(prefix - consumed);
      expect(decoder.error).toBeNull();
    }
  });
});

describe('FrameDecoder: oversized and empty frames', () => {
  it.each([MAX_FRAME_BYTES + 1, 0x00020000, 0x7fffffff, 0x80000000, 0xffffffff])(
    'declared length %i is frame-too-large as soon as the 4 header bytes are in',
    (declared) => {
      const header = u32ToBytes(declared);
      for (let split = 1; split <= 4; split++) {
        const decoder = new FrameDecoder();
        decoder.push(header.subarray(0, split));
        if (split < 4) {
          expect(decoder.next()).toBeNull(); // not enough to judge yet, and nothing thrown
          decoder.push(header.subarray(split));
        }
        const error = errorOf(() => decoder.next());
        expect(error.code).toBe('frame-too-large');
        expect(decoder.error).toBe(error);
      }
    },
  );

  it('does not wait for payload bytes: a 1-byte payload after a huge header never rescues it', () => {
    const decoder = new FrameDecoder();
    decoder.push(Uint8Array.of(0xff, 0xff, 0xff, 0xff, 0x01));
    expect(errorOf(() => decoder.next()).code).toBe('frame-too-large');
  });

  it('accepts MAX_FRAME_BYTES exactly', () => {
    const frame = new Uint8Array(MAX_FRAME_BYTES).fill(7);
    const out = decodeChunks([encodeFrame(frame)]);
    expect(out.length).toBe(1);
    expect(out[0]?.length).toBe(MAX_FRAME_BYTES);
  });

  it('a zero-length frame is malformed-frame', () => {
    const decoder = new FrameDecoder();
    decoder.push(new Uint8Array(4));
    expect(errorOf(() => decoder.next()).code).toBe('malformed-frame');
  });

  it('delivers the valid frames in front of a violation, then throws, then keeps throwing', () => {
    const decoder = new FrameDecoder();
    const good = encodeFrame(Uint8Array.of(1, 2, 3));
    decoder.push(Uint8Array.of(...good, 0xff, 0xff, 0xff, 0xff));
    expect(toHex(decoder.next() ?? new Uint8Array())).toBe('010203');
    const first = errorOf(() => decoder.next());
    expect(first.code).toBe('frame-too-large');
    expect(errorOf(() => decoder.next())).toBe(first);
    decoder.push(good); // poisoned: further bytes are ignored and nothing is buffered
    expect(decoder.bufferedBytes).toBe(0);
    expect(errorOf(() => decoder.next())).toBe(first);
  });

  it('a lowered limit applies to the next frame header, a raised one too (pull-based)', () => {
    const decoder = new FrameDecoder(100);
    decoder.push(streamOf([new Uint8Array(50), new Uint8Array(2000)]));
    expect(decoder.next()?.length).toBe(50);
    decoder.maxFrameBytes = 4096; // raised before the second header is judged
    expect(decoder.next()?.length).toBe(2000);

    const strict = new FrameDecoder();
    strict.push(streamOf([new Uint8Array(50), new Uint8Array(2000)]));
    expect(strict.next()?.length).toBe(50);
    strict.maxFrameBytes = 1000;
    expect(errorOf(() => strict.next()).code).toBe('frame-too-large');
  });

  it('refuses limits outside 1..MAX_FRAME_BYTES', () => {
    for (const bad of [0, -1, MAX_FRAME_BYTES + 1, 1.5, NaN]) {
      expect(() => new FrameDecoder(bad)).toThrow(RangeError);
      const decoder = new FrameDecoder();
      expect(() => {
        decoder.maxFrameBytes = bad;
      }).toThrow(RangeError);
    }
  });
});

describe('FrameDecoder: memory discipline', () => {
  /** Runs `action` while recording the largest `new Uint8Array(<number>)` the code under test asks for. */
  function largestAllocation(action: () => void): number {
    const Original = globalThis.Uint8Array;
    let largest = 0;
    const Spy = new Proxy(Original, {
      construct(target, args, newTarget) {
        if (typeof args[0] === 'number') largest = Math.max(largest, args[0]);
        return Reflect.construct(target, args, newTarget);
      },
    });
    globalThis.Uint8Array = Spy as typeof Original;
    try {
      action();
    } finally {
      globalThis.Uint8Array = Original;
    }
    return largest;
  }

  it('never sizes a buffer from an unvalidated declared length', () => {
    for (const declared of [MAX_FRAME_BYTES + 1, 0x7fffffff, 0xffffffff]) {
      const header = u32ToBytes(declared);
      const largest = largestAllocation(() => {
        const decoder = new FrameDecoder();
        decoder.push(header);
        expect(() => decoder.next()).toThrow(ProtocolError);
      });
      expect(largest).toBeLessThanOrEqual(256);
    }
  });

  it('even a valid declared length allocates only for bytes actually received', () => {
    const largest = largestAllocation(() => {
      const decoder = new FrameDecoder();
      decoder.push(u32ToBytes(MAX_FRAME_BYTES)); // claims 64 KiB, delivers nothing
      expect(decoder.next()).toBeNull();
      decoder.push(new Uint8Array(100));
      expect(decoder.next()).toBeNull();
    });
    expect(largest).toBeLessThan(MAX_FRAME_BYTES / 8);
  });

  it('copies pushed chunks: a transport that reuses its read buffer cannot corrupt a half-received frame', () => {
    const decoder = new FrameDecoder();
    const stream = streamOf([Uint8Array.of(1, 2, 3, 4, 5, 6)]);
    const shared = new Uint8Array(stream.length);
    shared.set(stream.subarray(0, 7));
    decoder.push(shared.subarray(0, 7));
    expect(decoder.next()).toBeNull();
    shared.fill(0xee); // the transport reuses its buffer for the next read
    decoder.push(stream.subarray(7));
    expect(toHex(decoder.next() ?? new Uint8Array())).toBe('010203040506');
  });

  it('hands out independent copies of each frame', () => {
    const decoder = new FrameDecoder();
    decoder.push(streamOf([Uint8Array.of(1, 2), Uint8Array.of(3, 4)]));
    const first = decoder.next();
    const second = decoder.next();
    first?.fill(0xff);
    expect(toHex(second ?? new Uint8Array())).toBe('0304');
  });

  it('rejects non-bytes with TypeError (a transport bug), including numbers and arrays', () => {
    const decoder = new FrameDecoder();
    for (const bad of [1, 'abc', [1, 2], null, undefined, new ArrayBuffer(4)]) {
      expect(() => decoder.push(bad as unknown as Uint8Array)).toThrow(TypeError);
    }
  });

  it('releases a large buffer once it runs empty', () => {
    const decoder = new FrameDecoder();
    decoder.push(streamOf([new Uint8Array(MAX_FRAME_BYTES)]));
    expect(decoder.next()?.length).toBe(MAX_FRAME_BYTES);
    expect(decoder.bufferedBytes).toBe(0);
    decoder.push(streamOf([Uint8Array.of(1)]));
    expect(decoder.next()?.length).toBe(1);
  });
});

describe('FrameDecoder: garbage', () => {
  it('fuzz: random byte streams only ever produce frames within the limit or a ProtocolError', () => {
    const next = mulberry32(777);
    for (let round = 0; round < 2000; round++) {
      const decoder = new FrameDecoder();
      const chunks = Array.from({ length: randomInt(next, 1, 6) }, () =>
        payloadOf(next, randomInt(next, 0, 40)),
      );
      try {
        for (const frame of decodeChunks(chunks, decoder)) {
          expect(frame.length).toBeGreaterThan(0);
          expect(frame.length).toBeLessThanOrEqual(MAX_FRAME_BYTES);
        }
      } catch (error) {
        expect(error).toBeInstanceOf(ProtocolError);
        expect(['frame-too-large', 'malformed-frame']).toContain((error as ProtocolError).code);
      }
    }
  });
});
