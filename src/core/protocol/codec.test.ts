import { describe, expect, it } from '@jest/globals';

import { base64urlEncode } from './base64url';
import { MAX_FRAME_BYTES } from './constants';
import {
  encodeHandshakeMessage,
  encodeSessionMessage,
  parseHandshakeMessage,
  parseSessionMessage,
} from './codec';
import { MAX_PEER_NAME_LENGTH, MAX_SUPPORTED_VERSIONS_LISTED } from './limits';
import type { SessionMessage } from './messages';
import { ProtocolError } from './secureChannel';
import { toHex, pattern } from './testing/hex';
import { mulberry32, randomInt } from './testing/rng';
import { utf8Decode, utf8Encode } from './utf8';

const PAIR_ID = base64urlEncode(pattern(16));
const NONCE = base64urlEncode(pattern(16, 100));
const PROOF = base64urlEncode(pattern(32, 50));

const json = (value: unknown): Uint8Array => utf8Encode(JSON.stringify(value));
const raw = (text: string): Uint8Array => utf8Encode(text);

function codeOf(action: () => unknown): string {
  try {
    action();
  } catch (error) {
    if (error instanceof ProtocolError) return error.code;
    throw error;
  }
  return 'no error';
}

const expectMalformed = (action: () => unknown): void => {
  expect(codeOf(action)).toBe('malformed-frame');
};

describe('parseHandshakeMessage: valid messages', () => {
  it('hello decodes the nonce to bytes and keeps the pair id text', () => {
    const message = parseHandshakeMessage(json({ type: 'hello', v: 1, pairId: PAIR_ID, nonce: NONCE }));
    expect(message.type).toBe('hello');
    if (message.type !== 'hello') return;
    expect(message.v).toBe(1);
    expect(message.pairId).toBe(PAIR_ID);
    expect(toHex(message.nonce)).toBe(toHex(pattern(16, 100)));
  });

  it('hello-ack carries nonce and proof as bytes', () => {
    const message = parseHandshakeMessage(json({ type: 'hello-ack', v: 1, nonce: NONCE, proof: PROOF }));
    expect(message.type).toBe('hello-ack');
    if (message.type !== 'hello-ack') return;
    expect(toHex(message.proof)).toBe(toHex(pattern(32, 50)));
    expect(message.nonce.length).toBe(16);
  });

  it('auth carries a 32-byte proof', () => {
    const message = parseHandshakeMessage(json({ type: 'auth', proof: PROOF }));
    expect(message.type === 'auth' && message.proof.length === 32).toBe(true);
  });

  it('reject, with and without supportedVersions', () => {
    expect(parseHandshakeMessage(json({ type: 'reject', reason: 'busy' }))).toEqual({
      type: 'reject',
      reason: 'busy',
      supportedVersions: undefined,
    });
    expect(
      parseHandshakeMessage(
        json({ type: 'reject', reason: 'unsupported-version', supportedVersions: [1, 2] }),
      ),
    ).toEqual({ type: 'reject', reason: 'unsupported-version', supportedVersions: [1, 2] });
  });

  it.each(['unsupported-version', 'unknown-pair', 'bad-proof', 'busy', 'malformed'])(
    'accepts reject reason %s',
    (reason) => {
      expect(parseHandshakeMessage(json({ type: 'reject', reason })).type).toBe('reject');
    },
  );

  it('ignores unknown extra properties and key order', () => {
    const message = parseHandshakeMessage(
      json({ nonce: NONCE, extra: { deep: [1, 2, 3] }, pairId: PAIR_ID, type: 'hello', v: 1 }),
    );
    expect(message.type).toBe('hello');
    expect(Object.keys(message).sort()).toEqual(['nonce', 'pairId', 'type', 'v']);
  });

  it('round-trips with encodeHandshakeMessage', () => {
    const bytes = encodeHandshakeMessage({ type: 'hello', v: 1, pairId: PAIR_ID, nonce: NONCE });
    expect(utf8Decode(bytes)).toBe(`{"type":"hello","v":1,"pairId":"${PAIR_ID}","nonce":"${NONCE}"}`);
    expect(parseHandshakeMessage(bytes).type).toBe('hello');
  });
});

describe('parseHandshakeMessage: malformed input', () => {
  const bad = <T>(base: T, patch: Record<string, unknown>): unknown => ({ ...base, ...patch });
  const hello = { type: 'hello', v: 1, pairId: PAIR_ID, nonce: NONCE };
  const ack = { type: 'hello-ack', v: 1, nonce: NONCE, proof: PROOF };
  const auth = { type: 'auth', proof: PROOF };

  it.each([
    ['not JSON', raw('{nope')],
    ['empty payload', new Uint8Array(0)],
    ['JSON array', raw('[1,2,3]')],
    ['JSON string', raw('"hello"')],
    ['JSON null', raw('null')],
    ['JSON number', raw('7')],
    ['invalid UTF-8', Uint8Array.of(0x7b, 0xff, 0x7d)],
    ['UTF-8 BOM before the object', Uint8Array.of(0xef, 0xbb, 0xbf, 0x7b, 0x7d)],
    ['no type', json({})],
    ['numeric type', json({ type: 5 })],
    ['unknown type', json({ type: 'welcome' })],
    ['a session message type', json({ type: 'ready' })],
    ['type in a different case', json({ ...hello, type: 'Hello' })],
  ])('rejects %s', (_label, bytes) => {
    expectMalformed(() => parseHandshakeMessage(bytes));
  });

  it.each([
    [
      'v missing',
      (() => {
        const { v: _v, ...rest } = hello;
        return rest;
      })(),
    ],
    ['v as string', bad(hello, { v: '1' })],
    ['v negative', bad(hello, { v: -1 })],
    ['v fractional', bad(hello, { v: 1.5 })],
    ['v beyond safe integers', bad(hello, { v: 2 ** 53 })],
    ['v null', bad(hello, { v: null })],
    [
      'pairId missing',
      (() => {
        const { pairId: _p, ...rest } = hello;
        return rest;
      })(),
    ],
    ['pairId too short', bad(hello, { pairId: PAIR_ID.slice(0, 21) })],
    ['pairId too long', bad(hello, { pairId: PAIR_ID + 'A' })],
    ['pairId with padding', bad(hello, { pairId: PAIR_ID + '==' })],
    ['pairId non-canonical last character', bad(hello, { pairId: PAIR_ID.slice(0, 21) + 'B' })],
    ['pairId standard alphabet', bad(hello, { pairId: PAIR_ID.slice(0, 5) + '+' + PAIR_ID.slice(6) })],
    ['pairId a number', bad(hello, { pairId: 12 })],
    ['nonce 15 bytes', bad(hello, { nonce: base64urlEncode(pattern(15)) })],
    ['nonce 17 bytes', bad(hello, { nonce: base64urlEncode(pattern(17)) })],
    [
      'nonce missing',
      (() => {
        const { nonce: _n, ...rest } = hello;
        return rest;
      })(),
    ],
    ['nonce an array of bytes', bad(hello, { nonce: Array.from(pattern(16)) })],
  ])('hello: %s', (_label, value) => {
    expectMalformed(() => parseHandshakeMessage(json(value)));
  });

  it.each([
    ['proof 31 bytes', bad(ack, { proof: base64urlEncode(pattern(31)) })],
    ['proof 33 bytes', bad(ack, { proof: base64urlEncode(pattern(33)) })],
    [
      'proof missing',
      (() => {
        const { proof: _p, ...rest } = ack;
        return rest;
      })(),
    ],
    ['nonce wrong length', bad(ack, { nonce: base64urlEncode(pattern(8)) })],
    [
      'v missing',
      (() => {
        const { v: _v, ...rest } = ack;
        return rest;
      })(),
    ],
  ])('hello-ack: %s', (_label, value) => {
    expectMalformed(() => parseHandshakeMessage(json(value)));
  });

  it.each([
    ['proof 16 bytes', bad(auth, { proof: base64urlEncode(pattern(16)) })],
    ['proof missing', { type: 'auth' }],
    ['proof padded', bad(auth, { proof: PROOF + '=' })],
    ['proof null', bad(auth, { proof: null })],
  ])('auth: %s', (_label, value) => {
    expectMalformed(() => parseHandshakeMessage(json(value)));
  });

  it.each([
    ['reason missing', { type: 'reject' }],
    ['reason unknown', { type: 'reject', reason: 'because' }],
    ['reason numeric', { type: 'reject', reason: 3 }],
    ['supportedVersions a string', { type: 'reject', reason: 'busy', supportedVersions: '1' }],
    ['supportedVersions with a string', { type: 'reject', reason: 'busy', supportedVersions: [1, '2'] }],
    ['supportedVersions negative', { type: 'reject', reason: 'busy', supportedVersions: [-1] }],
    ['supportedVersions fractional', { type: 'reject', reason: 'busy', supportedVersions: [1.5] }],
    ['supportedVersions null', { type: 'reject', reason: 'busy', supportedVersions: null }],
    [
      'supportedVersions too long',
      {
        type: 'reject',
        reason: 'busy',
        supportedVersions: Array.from({ length: MAX_SUPPORTED_VERSIONS_LISTED + 1 }, () => 1),
      },
    ],
  ])('reject: %s', (_label, value) => {
    expectMalformed(() => parseHandshakeMessage(json(value)));
  });

  it('inherited properties are not message fields: "constructor" / "toString" / "__proto__" tricks fail', () => {
    expectMalformed(() => parseHandshakeMessage(raw('{"type":"hello","v":1,"__proto__":{"pairId":"x"}}')));
    expectMalformed(() => parseHandshakeMessage(raw('{"__proto__":{"type":"auth"}}')));
    expectMalformed(() => parseHandshakeMessage(raw('{"type":"auth","constructor":"x"}')));
  });

  it('a hostile __proto__ key cannot pollute Object.prototype or the result', () => {
    const message = parseHandshakeMessage(
      raw(`{"type":"auth","proof":"${PROOF}","__proto__":{"polluted":true}}`),
    );
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    expect((message as unknown as Record<string, unknown>).polluted).toBeUndefined();
  });
});

describe('parseSessionMessage: valid messages', () => {
  const corpus: SessionMessage[] = [
    { type: 'ready' },
    { type: 'sdp', generation: 0, kind: 'offer', sdp: 'v=0\r\no=- 1 1 IN IP4 0.0.0.0\r\n' },
    { type: 'sdp', generation: 12, kind: 'answer', sdp: '' },
    { type: 'ice', generation: 3, candidate: null },
    {
      type: 'ice',
      generation: 3,
      candidate: {
        candidate: 'candidate:1 1 udp 2122260223 192.168.1.5 50000 typ host',
        sdpMid: '0',
        sdpMLineIndex: 0,
      },
    },
    { type: 'ice', generation: 1, candidate: { candidate: '', sdpMid: null, sdpMLineIndex: null } },
    { type: 'ping', id: 0, t: 0 },
    { type: 'ping', id: 4, t: 1763350000123 },
    { type: 'pong', id: 4, t: 1763350000123.5 },
    {
      type: 'peer-state',
      name: 'Riya',
      muted: false,
      headsetConnected: true,
      batteryPct: 87,
      charging: false,
      interruption: 'none',
    },
    {
      type: 'peer-state',
      name: 'रिया 😀',
      muted: true,
      headsetConnected: false,
      batteryPct: null,
      charging: null,
      interruption: 'headset-disconnected',
    },
    {
      type: 'peer-state',
      name: 'x',
      muted: false,
      headsetConnected: true,
      batteryPct: 0,
      charging: true,
      interruption: 'phone-call',
    },
    { type: 'bye', reason: 'user-ended' },
    { type: 'bye', reason: 'phone-call' },
    { type: 'bye', reason: 'error' },
  ];

  it.each(corpus.map((message, index) => [index, message] as const))(
    'corpus %i round-trips unchanged',
    (_i, message) => {
      const bytes = encodeSessionMessage(message);
      expect(parseSessionMessage(bytes)).toEqual(message);
    },
  );

  it('drops unknown extra properties instead of passing them on', () => {
    const parsed = parseSessionMessage(json({ type: 'bye', reason: 'error', admin: true, nested: { a: 1 } }));
    expect(parsed).toEqual({ type: 'bye', reason: 'error' });
  });

  it('normalises absent nullable fields to null (JSON.stringify drops undefined)', () => {
    expect(parseSessionMessage(json({ type: 'ice', generation: 1, candidate: { candidate: 'c' } }))).toEqual({
      type: 'ice',
      generation: 1,
      candidate: { candidate: 'c', sdpMid: null, sdpMLineIndex: null },
    });
    expect(
      parseSessionMessage(
        json({ type: 'peer-state', name: 'n', muted: false, headsetConnected: false, interruption: 'none' }),
      ),
    ).toEqual({
      type: 'peer-state',
      name: 'n',
      muted: false,
      headsetConnected: false,
      batteryPct: null,
      charging: null,
      interruption: 'none',
    });
  });

  it('accepts the longest name and an SDP that fills almost a whole frame', () => {
    const name = 'n'.repeat(MAX_PEER_NAME_LENGTH);
    const state = {
      type: 'peer-state',
      name,
      muted: false,
      headsetConnected: true,
      batteryPct: 1,
      charging: false,
      interruption: 'none',
    } as const;
    expect(parseSessionMessage(encodeSessionMessage(state))).toEqual(state);
    const sdp = 'a'.repeat(MAX_FRAME_BYTES - 200);
    expect(
      parseSessionMessage(encodeSessionMessage({ type: 'sdp', generation: 1, kind: 'offer', sdp })),
    ).toEqual({
      type: 'sdp',
      generation: 1,
      kind: 'offer',
      sdp,
    });
  });
});

describe('parseSessionMessage: malformed input', () => {
  const sdp = { type: 'sdp', generation: 1, kind: 'offer', sdp: 'v=0' };
  const ice = { type: 'ice', generation: 1, candidate: { candidate: 'c', sdpMid: '0', sdpMLineIndex: 0 } };
  const ping = { type: 'ping', id: 1, t: 5 };
  const state = {
    type: 'peer-state',
    name: 'n',
    muted: false,
    headsetConnected: true,
    batteryPct: 50,
    charging: false,
    interruption: 'none',
  };
  const patch = (base: object, change: Record<string, unknown>): unknown => ({ ...base, ...change });
  const without = (base: Record<string, unknown>, key: string): unknown => {
    const copy = { ...base };
    delete copy[key];
    return copy;
  };

  it.each([
    ['unknown type', { type: 'chat' }],
    ['handshake type', { type: 'hello', v: 1, pairId: PAIR_ID, nonce: NONCE }],
    ['reject is not a session message', { type: 'reject', reason: 'busy' }],
    ['no type', {}],
    ['type not a string', { type: ['ready'] }],
  ])('rejects %s', (_label, value) => {
    expectMalformed(() => parseSessionMessage(json(value)));
  });

  it.each([
    ['not JSON', raw('ready')],
    ['empty', new Uint8Array(0)],
    ['array', raw('[]')],
    ['invalid UTF-8', Uint8Array.of(0x7b, 0xc3, 0x28, 0x7d)],
    ['truncated JSON', raw('{"type":"ready"')],
    ['trailing garbage', raw('{"type":"ready"}x')],
  ])('rejects bytes that are %s', (_label, bytes) => {
    expectMalformed(() => parseSessionMessage(bytes));
  });

  it.each([
    ['generation missing', without(sdp, 'generation')],
    ['generation negative', patch(sdp, { generation: -1 })],
    ['generation fractional', patch(sdp, { generation: 0.5 })],
    ['generation a string', patch(sdp, { generation: '1' })],
    ['generation unsafe', patch(sdp, { generation: 2 ** 53 })],
    ['kind unknown', patch(sdp, { kind: 'rollback' })],
    ['kind missing', without(sdp, 'kind')],
    ['sdp missing', without(sdp, 'sdp')],
    ['sdp not a string', patch(sdp, { sdp: 5 })],
    ['sdp null', patch(sdp, { sdp: null })],
    ['sdp longer than one frame', patch(sdp, { sdp: 'x'.repeat(MAX_FRAME_BYTES + 1) })],
  ])('sdp: %s', (_label, value) => {
    expectMalformed(() => parseSessionMessage(json(value)));
  });

  it.each([
    ['candidate key missing', without(ice, 'candidate')],
    ['candidate a string', patch(ice, { candidate: 'candidate:1 ...' })],
    ['candidate an array', patch(ice, { candidate: [] })],
    ['candidate.candidate missing', patch(ice, { candidate: { sdpMid: '0', sdpMLineIndex: 0 } })],
    [
      'candidate.candidate a number',
      patch(ice, { candidate: { candidate: 1, sdpMid: '0', sdpMLineIndex: 0 } }),
    ],
    ['sdpMid a number', patch(ice, { candidate: { candidate: 'c', sdpMid: 0, sdpMLineIndex: 0 } })],
    [
      'sdpMid too long',
      patch(ice, { candidate: { candidate: 'c', sdpMid: 'm'.repeat(300), sdpMLineIndex: 0 } }),
    ],
    ['sdpMLineIndex negative', patch(ice, { candidate: { candidate: 'c', sdpMid: '0', sdpMLineIndex: -1 } })],
    [
      'sdpMLineIndex a string',
      patch(ice, { candidate: { candidate: 'c', sdpMid: '0', sdpMLineIndex: '0' } }),
    ],
    ['generation missing', without(ice, 'generation')],
  ])('ice: %s', (_label, value) => {
    expectMalformed(() => parseSessionMessage(json(value)));
  });

  it.each([
    ['ping id missing', without(ping, 'id')],
    ['ping id negative', patch(ping, { id: -1 })],
    ['ping id fractional', patch(ping, { id: 1.1 })],
    ['ping t missing', without(ping, 't')],
    ['ping t null (NaN in JSON)', patch(ping, { t: null })],
    ['ping t a string', patch(ping, { t: '5' })],
    ['pong t infinite (1e999)', raw('{"type":"pong","id":1,"t":1e999}')],
    ['pong id a string', { type: 'pong', id: '1', t: 1 }],
  ])('%s', (_label, value) => {
    expectMalformed(() => parseSessionMessage(value instanceof Uint8Array ? value : json(value)));
  });

  it.each([
    ['name missing', without(state, 'name')],
    ['name not a string', patch(state, { name: 5 })],
    ['name too long', patch(state, { name: 'n'.repeat(MAX_PEER_NAME_LENGTH + 1) })],
    ['muted a string', patch(state, { muted: 'false' })],
    ['muted missing', without(state, 'muted')],
    ['muted a number', patch(state, { muted: 0 })],
    ['headsetConnected missing', without(state, 'headsetConnected')],
    ['batteryPct a string', patch(state, { batteryPct: '50' })],
    ['batteryPct infinite', raw(JSON.stringify(state).replace('50', '1e999'))],
    ['charging a string', patch(state, { charging: 'yes' })],
    ['interruption unknown', patch(state, { interruption: 'call' })],
    ['interruption missing', without(state, 'interruption')],
    ['bye reason unknown', { type: 'bye', reason: 'because' }],
    ['bye reason missing', { type: 'bye' }],
  ])('%s', (_label, value) => {
    expectMalformed(() => parseSessionMessage(value instanceof Uint8Array ? value : json(value)));
  });
});

describe('encodeSessionMessage', () => {
  it('normalises NaN to null and drops undefined, like JSON, and validates what is left', () => {
    const bytes = encodeSessionMessage({
      type: 'peer-state',
      name: 'n',
      muted: false,
      headsetConnected: true,
      batteryPct: NaN,
      charging: undefined as unknown as null,
      interruption: 'none',
    });
    expect(parseSessionMessage(bytes)).toMatchObject({ batteryPct: null, charging: null });
  });

  it.each([
    ['wrong type tag', { type: 'bogus' }],
    ['missing field', { type: 'sdp', generation: 1, kind: 'offer' }],
    ['undefined message', undefined],
    ['null message', null],
    ['a string', 'ready'],
    ['an array', []],
    ['a function', () => 1],
  ])('refuses %s with malformed-frame', (_label, value) => {
    expectMalformed(() => encodeSessionMessage(value as unknown as SessionMessage));
  });

  it('refuses unserialisable values (BigInt, cycles) without leaking the engine error', () => {
    expectMalformed(() =>
      encodeSessionMessage({ type: 'ping', id: BigInt(1), t: 1 } as unknown as SessionMessage),
    );
    const cyclic: Record<string, unknown> = { type: 'ping', id: 1, t: 1 };
    cyclic.self = cyclic;
    expectMalformed(() => encodeSessionMessage(cyclic as unknown as SessionMessage));
  });

  it('is deterministic: the same message gives the same bytes', () => {
    const message: SessionMessage = { type: 'ping', id: 9, t: 100 };
    expect(toHex(encodeSessionMessage(message))).toBe(toHex(encodeSessionMessage({ ...message })));
    expect(utf8Decode(encodeSessionMessage(message))).toBe('{"type":"ping","id":9,"t":100}');
  });
});

describe('codec fuzzing', () => {
  function randomJson(next: () => number, depth: number): unknown {
    const kind = next();
    if (depth <= 0 || kind < 0.5) {
      const leaf = next();
      if (leaf < 0.2) return null;
      if (leaf < 0.3) return next() < 0.5;
      if (leaf < 0.55) return randomInt(next, -5, 100000) / (next() < 0.8 ? 1 : 4);
      return [
        'ready',
        'sdp',
        'ice',
        'ping',
        'peer-state',
        'bye',
        'offer',
        'none',
        '',
        'x'.repeat(randomInt(next, 0, 30)),
      ][randomInt(next, 0, 9)];
    }
    if (kind < 0.75) return Array.from({ length: randomInt(next, 0, 3) }, () => randomJson(next, depth - 1));
    const keys = [
      'type',
      'generation',
      'kind',
      'sdp',
      'candidate',
      'id',
      't',
      'name',
      'muted',
      'reason',
      'v',
      'proof',
      'nonce',
      'pairId',
    ];
    const object: Record<string, unknown> = {};
    for (let i = 0; i < randomInt(next, 0, 5); i++)
      object[keys[randomInt(next, 0, keys.length - 1)] ?? 'type'] = randomJson(next, depth - 1);
    return object;
  }

  it('random JSON documents are either rejected as malformed-frame or parse to a stable valid message', () => {
    const next = mulberry32(60606);
    let accepted = 0;
    for (let i = 0; i < 6000; i++) {
      const bytes = json(randomJson(next, 3));
      for (const parse of [parseSessionMessage, parseHandshakeMessage]) {
        try {
          const first = parse(bytes);
          accepted += 1;
          // Stability: serialising the parsed message and parsing again gives the same message.
          if (parse === parseSessionMessage) {
            const again = parseSessionMessage(encodeSessionMessage(first as SessionMessage));
            expect(again).toEqual(first);
          }
        } catch (error) {
          expect(error).toBeInstanceOf(ProtocolError);
          expect((error as ProtocolError).code).toBe('malformed-frame');
        }
      }
    }
    expect(accepted).toBeGreaterThan(0);
  });

  it('byte-level mutations of valid messages never throw anything but malformed-frame', () => {
    const next = mulberry32(90909);
    const seeds = [
      json({ type: 'sdp', generation: 2, kind: 'offer', sdp: 'v=0\r\n' }),
      json({ type: 'ice', generation: 2, candidate: { candidate: 'c', sdpMid: '0', sdpMLineIndex: 0 } }),
      json({
        type: 'peer-state',
        name: 'n',
        muted: false,
        headsetConnected: true,
        batteryPct: 5,
        charging: null,
        interruption: 'none',
      }),
      json({ type: 'hello', v: 1, pairId: PAIR_ID, nonce: NONCE }),
      json({ type: 'hello-ack', v: 1, nonce: NONCE, proof: PROOF }),
      json({ type: 'reject', reason: 'busy', supportedVersions: [1] }),
    ];
    for (let i = 0; i < 6000; i++) {
      const bytes = new Uint8Array(seeds[randomInt(next, 0, seeds.length - 1)] ?? new Uint8Array());
      const kind = next();
      if (kind < 0.5) bytes[randomInt(next, 0, bytes.length - 1)] = randomInt(next, 0, 255);
      const mutated = kind < 0.2 ? bytes.subarray(0, randomInt(next, 0, bytes.length)) : bytes;
      for (const parse of [parseSessionMessage, parseHandshakeMessage]) {
        try {
          parse(mutated);
        } catch (error) {
          expect(error).toBeInstanceOf(ProtocolError);
          expect((error as ProtocolError).code).toBe('malformed-frame');
        }
      }
    }
  });
});

describe('error messages never echo wire content', () => {
  const MARKER = 'ZXQ-MARKER-7731';

  it.each([
    ['type', { type: MARKER }],
    ['reason', { type: 'reject', reason: MARKER }],
    ['pairId', { type: 'hello', v: 1, pairId: MARKER, nonce: NONCE }],
    ['nonce', { type: 'hello', v: 1, pairId: PAIR_ID, nonce: MARKER }],
    ['proof', { type: 'auth', proof: MARKER }],
    ['kind', { type: 'sdp', generation: 1, kind: MARKER, sdp: 'v=0' }],
    [
      'interruption',
      { type: 'peer-state', name: 'n', muted: false, headsetConnected: true, interruption: MARKER },
    ],
  ])('a hostile %s value does not appear in the error', (_label, value) => {
    for (const parse of [parseSessionMessage, parseHandshakeMessage]) {
      try {
        parse(json(value));
      } catch (error) {
        const text = `${String(error)}\n${(error as Error).stack ?? ''}`;
        expect(text.includes(MARKER)).toBe(false);
      }
    }
  });

  it('a JSON syntax error does not carry a slice of the input', () => {
    try {
      parseSessionMessage(raw(`{"type":"${MARKER}`));
      throw new Error('should have thrown');
    } catch (error) {
      expect(((error as Error).message + ((error as Error).stack ?? '')).includes(MARKER)).toBe(false);
    }
  });
});
