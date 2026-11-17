/// <reference types="node" />
import { afterEach, describe, expect, it } from '@jest/globals';

import { base64urlDecode, base64urlEncode } from './base64url';
import { concatBytes } from './bytes';
import {
  encodeHandshakeMessage,
  encodeSessionMessage,
  parseSessionMessage,
  type ParsedHelloAck,
} from './codec';
import { establishSecureChannel } from './establish';
import { encodeFrame } from './frame';
import {
  computeProof,
  deriveAuthKey,
  deriveSessionKeys,
  openFrame,
  sealFrame,
  type SessionKeys,
} from './handshake';
import { DEFAULT_HANDSHAKE_TIMEOUT_MS, MAX_HANDSHAKE_FRAME_BYTES } from './limits';
import type { HandshakeMessage, RejectReason, SessionMessage } from './messages';
import { createCryptoProvider } from './noble';
import { ProtocolError, type ProtocolErrorCode, type SecureChannel } from './secureChannel';
import { bytesEqual, pattern, toHex } from './testing/hex';
import { settle } from './testing/memoryPipe';
import { RawPeer } from './testing/rawPeer';
import {
  OTHER_PAIR_ID,
  OTHER_SECRET,
  PAIR_ID,
  SECRET,
  assertNoLeak,
  codeOf,
  countingCrypto,
  describeError,
  framesSentBy,
  makeRig,
  outcome,
  type Outcome,
  type Rig,
} from './testing/rig';
import { scriptedRandomBytes, seededRandomBytes } from './testing/rng';
import { ManualTimers } from './testing/timers';
import { utf8Decode, utf8Encode } from './utf8';

afterEach(async () => {
  await settle(); // an unhandled promise rejection anywhere in the code under test fails the test that caused it
});

// ---- a scripted peer that speaks the protocol by hand, using the already-verified primitives -------------------

const scriptCrypto = createCryptoProvider(seededRandomBytes(424242));
const PAIR_ID_BYTES = base64urlDecode(PAIR_ID) ?? new Uint8Array();
const NONCE_G = pattern(16, 0x33);
const NONCE_H = pattern(16, 0x55);
const b64 = base64urlEncode;
const ping = (id: number): SessionMessage => ({ type: 'ping', id, t: id });

const hello = (overrides: Partial<{ v: number; pairId: string; nonce: string }> = {}): HandshakeMessage => ({
  type: 'hello',
  v: 1,
  pairId: PAIR_ID,
  nonce: b64(NONCE_G),
  ...overrides,
});

const guestProofFor = (nonceHost: Uint8Array, secret = SECRET, nonceGuest = NONCE_G): Uint8Array =>
  computeProof(
    scriptCrypto,
    deriveAuthKey(scriptCrypto, secret),
    'guest',
    PAIR_ID_BYTES,
    nonceGuest,
    nonceHost,
  );

const hostProofFor = (nonceHost: Uint8Array, secret = SECRET, nonceGuest = NONCE_G): Uint8Array =>
  computeProof(
    scriptCrypto,
    deriveAuthKey(scriptCrypto, secret),
    'host',
    PAIR_ID_BYTES,
    nonceGuest,
    nonceHost,
  );

const keysFor = (nonceHost: Uint8Array, secret = SECRET, nonceGuest = NONCE_G): SessionKeys =>
  deriveSessionKeys(scriptCrypto, secret, nonceGuest, nonceHost);

/** A real host, with a scripted guest on the other end of the pipe. */
function realHost(rig: Rig, overrides: Parameters<Rig['hostOptions']>[0] = {}) {
  const pending = outcome(establishSecureChannel(rig.hostEnd, rig.hostOptions(overrides)));
  const script = new RawPeer(rig.guestEnd);
  return { pending, script };
}

/** A real guest, with a scripted host on the other end. */
function realGuest(rig: Rig, overrides: Parameters<Rig['guestOptions']>[0] = {}) {
  const script = new RawPeer(rig.hostEnd);
  const pending = outcome(establishSecureChannel(rig.guestEnd, rig.guestOptions(overrides)));
  return { pending, script };
}

/** Drives a scripted guest through a CORRECT handshake against a real host. */
async function guestHandshake(rig: Rig, hostOverrides: Parameters<Rig['hostOptions']>[0] = {}) {
  const { pending, script } = realHost(rig, hostOverrides);
  await script.sendHandshake(hello());
  const ack = (await script.nextHandshake()) as ParsedHelloAck;
  expect(ack.type).toBe('hello-ack');
  await script.sendHandshake({ type: 'auth', proof: b64(guestProofFor(ack.nonce)) });
  const keys = keysFor(ack.nonce);
  const readyFrame = await script.next();
  const opened = openFrame(scriptCrypto, keys.hostToGuest, 0, readyFrame);
  expect(opened.ok).toBe(true);
  const result = await pending;
  if (!result.ok) throw new Error(`handshake failed: ${codeOf(result)}`);
  return { host: result.channel, script, keys, nonceHost: ack.nonce };
}

/** Drives a scripted host through a CORRECT handshake against a real guest. */
async function hostHandshake(rig: Rig, guestOverrides: Parameters<Rig['guestOptions']>[0] = {}) {
  const { pending, script } = realGuest(rig, guestOverrides);
  const helloMessage = await script.nextHandshake();
  if (helloMessage.type !== 'hello') throw new Error('guest did not start with hello');
  const nonceGuest = helloMessage.nonce;
  await script.sendHandshake({
    type: 'hello-ack',
    v: 1,
    nonce: b64(NONCE_H),
    proof: b64(hostProofFor(NONCE_H, SECRET, nonceGuest)),
  });
  const authMessage = await script.nextHandshake();
  if (authMessage.type !== 'auth') throw new Error('guest did not answer with auth');
  expect(bytesEqual(authMessage.proof, guestProofFor(NONCE_H, SECRET, nonceGuest))).toBe(true);
  const keys = keysFor(NONCE_H, SECRET, nonceGuest);
  await script.sendFrame(
    sealFrame(scriptCrypto, keys.hostToGuest, 0, encodeSessionMessage({ type: 'ready' })),
  );
  const result = await pending;
  if (!result.ok) throw new Error(`handshake failed: ${codeOf(result)}`);
  return { guest: result.channel, script, keys, nonceGuest };
}

function collect(channel: SecureChannel): SessionMessage[] {
  const messages: SessionMessage[] = [];
  channel.onMessage((message) => messages.push(message));
  return messages;
}

function closeReasons(channel: SecureChannel): string[] {
  const reasons: string[] = [];
  channel.onClose((reason) => reasons.push(reason));
  return reasons;
}

const authenticated = (key: Uint8Array, counter: number, message: SessionMessage): Uint8Array =>
  sealFrame(scriptCrypto, key, counter, encodeSessionMessage(message));

function rejectFrame(frames: Uint8Array[], index: number): { reason: string; supportedVersions?: number[] } {
  const frame = frames[index];
  if (frame === undefined) throw new Error(`no frame at ${index}`);
  return JSON.parse(utf8Decode(frame) ?? '{}') as { reason: string; supportedVersions?: number[] };
}

// ==================================================================================================================

describe('wrong secret', () => {
  it('both sides refuse: the guest with bad-proof, the host learns bad-proof from the guest`s reject hint', async () => {
    const rig = makeRig();
    const [guest, host] = await Promise.all([
      outcome(establishSecureChannel(rig.guestEnd, rig.guestOptions({ secret: OTHER_SECRET }))),
      outcome(establishSecureChannel(rig.hostEnd, rig.hostOptions())),
    ]);
    expect(codeOf(guest)).toBe('bad-proof');
    expect(codeOf(host)).toBe('bad-proof');
    expect(rig.guestEnd.closeCalls).toBe(1);
    // The host never got as far as deriving session keys or sending `ready`: only hello-ack went out.
    expect(rig.hostEnd.sent.length).toBe(1);
    // The guest sent hello and the courtesy reject, but never `auth` (it would have proved nothing and leaked a MAC).
    const guestFrames = framesSentBy(rig.guestEnd);
    expect(guestFrames.length).toBe(2);
    expect(rejectFrame(guestFrames, 1).reason).toBe('bad-proof');
  });

  it('a host holding the wrong secret is refused by the guest, which never reveals its own proof', async () => {
    const rig = makeRig();
    const [guest, host] = await Promise.all([
      outcome(establishSecureChannel(rig.guestEnd, rig.guestOptions())),
      outcome(establishSecureChannel(rig.hostEnd, rig.hostOptions({ secret: OTHER_SECRET }))),
    ]);
    expect(codeOf(guest)).toBe('bad-proof');
    expect(codeOf(host)).toBe('bad-proof');
    for (const frame of framesSentBy(rig.guestEnd)) {
      expect(utf8Decode(frame)?.includes('"type":"auth"')).toBe(false);
    }
  });

  it('a scripted guest that proves with the wrong secret gets reject{bad-proof} and a closed link', async () => {
    const rig = makeRig();
    const { pending, script } = realHost(rig);
    await script.sendHandshake(hello());
    const ack = (await script.nextHandshake()) as ParsedHelloAck;
    await script.sendHandshake({ type: 'auth', proof: b64(guestProofFor(ack.nonce, OTHER_SECRET)) });
    expect(codeOf(await pending)).toBe('bad-proof');
    await settle();
    expect(rejectFrame(script.frames, 1).reason).toBe('bad-proof');
    expect(rig.hostEnd.closeCalls).toBe(1);
    expect(script.frames.length).toBe(2); // hello-ack and the reject: no `ready`, nothing authenticated
  });

  it('a proof that is off by a single bit is refused', async () => {
    const proof = guestProofFor(NONCE_H);
    for (const [index, bit] of [
      [0, 0],
      [15, 3],
      [31, 7],
    ] as const) {
      const rig = makeRig({ seed: 7 });
      const forced = createCryptoProvider(scriptedRandomBytes([NONCE_H]));
      const { pending, script } = realHost(rig, { crypto: forced });
      await script.sendHandshake(hello());
      await script.nextHandshake();
      const tampered = new Uint8Array(proof);
      tampered[index] = (tampered[index] ?? 0) ^ (1 << bit);
      await script.sendHandshake({ type: 'auth', proof: b64(tampered) });
      expect(codeOf(await pending)).toBe('bad-proof');
    }
  });

  it('control for the test above: the untampered proof is accepted (so the refusals are meaningful)', async () => {
    const rig = makeRig({ seed: 7 });
    const forced = createCryptoProvider(scriptedRandomBytes([NONCE_H]));
    const { pending, script } = realHost(rig, { crypto: forced });
    await script.sendHandshake(hello());
    await script.nextHandshake();
    await script.sendHandshake({ type: 'auth', proof: b64(guestProofFor(NONCE_H)) });
    expect((await pending).ok).toBe(true);
  });

  it('an empty, truncated or oversized proof is refused as malformed, never compared', async () => {
    for (const proof of ['', b64(pattern(31)), b64(pattern(33)), b64(new Uint8Array(32)).slice(0, 40)]) {
      const rig = makeRig();
      const { pending, script } = realHost(rig);
      await script.sendHandshake(hello());
      await script.nextHandshake();
      await script.sendHandshake({ type: 'auth', proof });
      expect(codeOf(await pending)).toBe('malformed-frame');
    }
  });
});

describe('wrong pair id', () => {
  it('the host answers reject{unknown-pair} and does NO crypto and draws no randomness first', async () => {
    const rig = makeRig();
    const spy = countingCrypto(rig.hostCrypto);
    const { pending, script } = realHost(rig, { crypto: spy.crypto });
    await script.sendHandshake(hello({ pairId: OTHER_PAIR_ID }));
    expect(codeOf(await pending)).toBe('unknown-pair');
    expect(spy.total()).toBe(0);
    await settle();
    expect(script.frames.length).toBe(1);
    expect(rejectFrame(script.frames, 0).reason).toBe('unknown-pair');
    expect(rig.hostEnd.closeCalls).toBe(1);
  });

  it('end to end: guest and host with different pair ids both end with unknown-pair', async () => {
    const rig = makeRig();
    const hostSpy = countingCrypto(rig.hostCrypto);
    const [guest, host] = await Promise.all([
      outcome(establishSecureChannel(rig.guestEnd, rig.guestOptions({ pairId: OTHER_PAIR_ID }))),
      outcome(establishSecureChannel(rig.hostEnd, rig.hostOptions({ crypto: hostSpy.crypto }))),
    ]);
    expect(codeOf(guest)).toBe('unknown-pair'); // from the host's unauthenticated reject hint
    expect(codeOf(host)).toBe('unknown-pair');
    expect(hostSpy.total()).toBe(0);
  });

  it('a pair id that differs in a single character is unknown', async () => {
    const lastChar = PAIR_ID.slice(-1);
    for (const index of [0, 10, 20]) {
      const wrongChar = PAIR_ID[index] === 'A' ? 'B' : 'A';
      const mutated = PAIR_ID.slice(0, index) + wrongChar + PAIR_ID.slice(index + 1);
      expect(mutated).not.toBe(PAIR_ID);
      const rig = makeRig();
      const { pending, script } = realHost(rig);
      await script.sendHandshake(hello({ pairId: mutated }));
      expect(codeOf(await pending)).toBe('unknown-pair');
    }
    expect(lastChar.length).toBe(1);
  });

  it('a malformed pair id is `malformed-frame`, not a lookup', async () => {
    for (const pairId of ['', 'short', PAIR_ID + 'x', PAIR_ID.slice(0, 21) + 'B']) {
      const rig = makeRig();
      const spy = countingCrypto(rig.hostCrypto);
      const { pending, script } = realHost(rig, { crypto: spy.crypto });
      await script.sendHandshake(hello({ pairId }));
      expect(codeOf(await pending)).toBe('malformed-frame');
      expect(spy.total()).toBe(0);
    }
  });
});

describe('version negotiation', () => {
  it('host: an unsupported version gets reject{unsupported-version, supportedVersions:[1]} before any crypto', async () => {
    for (const v of [0, 2, 3, 99, 2 ** 31]) {
      const rig = makeRig();
      const spy = countingCrypto(rig.hostCrypto);
      const { pending, script } = realHost(rig, { crypto: spy.crypto });
      await script.sendHandshake(hello({ v }));
      const result = await pending;
      expect(codeOf(result)).toBe('unsupported-version');
      expect(spy.total()).toBe(0);
      await settle();
      const reject = rejectFrame(script.frames, 0);
      expect(reject.reason).toBe('unsupported-version');
      expect(reject.supportedVersions).toEqual([1]);
      expect(rig.hostEnd.closeCalls).toBe(1);
    }
  });

  it('host: the version is checked before the pair id (a future format may change the rest of the message)', async () => {
    const rig = makeRig();
    const { pending, script } = realHost(rig);
    await script.sendHandshake(hello({ v: 7, pairId: OTHER_PAIR_ID }));
    expect(codeOf(await pending)).toBe('unsupported-version');
    await settle();
    expect(rejectFrame(script.frames, 0).reason).toBe('unsupported-version');
  });

  it('host: a version of the wrong type is malformed, not unsupported', async () => {
    const rig = makeRig();
    const { pending, script } = realHost(rig);
    await script.sendFrame(
      utf8Encode(`{"type":"hello","v":"1","pairId":"${PAIR_ID}","nonce":"${b64(NONCE_G)}"}`),
    );
    expect(codeOf(await pending)).toBe('malformed-frame');
  });

  it('guest: a hello-ack for a different version is refused even though its proof is valid, and the host is told', async () => {
    const rig = makeRig();
    const { pending, script } = realGuest(rig);
    const first = await script.nextHandshake();
    if (first.type !== 'hello') throw new Error('expected hello');
    expect(first.v).toBe(1);
    await script.sendHandshake({
      type: 'hello-ack',
      v: 2,
      nonce: b64(NONCE_H),
      proof: b64(hostProofFor(NONCE_H, SECRET, first.nonce)),
    });
    expect(codeOf(await pending)).toBe('unsupported-version');
    await settle();
    const reject = rejectFrame(script.frames, 1);
    expect(reject.reason).toBe('unsupported-version');
    expect(reject.supportedVersions).toEqual([1]);
    expect(script.frames.length).toBe(2); // hello and the reject, never `auth`
    expect(rig.guestEnd.closeCalls).toBe(1);
  });

  it('guest: a peer that answers reject{unsupported-version, [2,3]} ends the handshake with that hint', async () => {
    const rig = makeRig();
    const { pending, script } = realGuest(rig);
    await script.nextHandshake();
    await script.sendHandshake({ type: 'reject', reason: 'unsupported-version', supportedVersions: [2, 3] });
    const result = await pending;
    expect(codeOf(result)).toBe('unsupported-version');
    expect(rig.guestEnd.closeCalls).toBe(1);
  });

  it('real guest against a (hypothetical) host that only speaks v2: a clean unsupported-version, no hang', async () => {
    const rig = makeRig();
    const { pending, script } = realGuest(rig);
    await script.nextHandshake();
    await script.sendHandshake({ type: 'reject', reason: 'unsupported-version', supportedVersions: [2] });
    expect(codeOf(await pending)).toBe('unsupported-version');
  });
});

describe('a scripted guest breaking the protocol against a real host', () => {
  it.each([
    ['invalid JSON', utf8Encode('{"type":"hello"')],
    ['invalid UTF-8', Uint8Array.of(0x7b, 0xc3, 0x28, 0x7d)],
    ['a JSON array', utf8Encode('[1,2,3]')],
    ['a JSON string', utf8Encode('"hello"')],
    ['an unknown message type', utf8Encode('{"type":"hola"}')],
    ['a session message type', utf8Encode('{"type":"ready"}')],
    ['an `auth` before any hello', encodeHandshakeMessage({ type: 'auth', proof: b64(pattern(32)) })],
    [
      'a hello-ack (the host`s own message)',
      encodeHandshakeMessage({ type: 'hello-ack', v: 1, nonce: b64(NONCE_H), proof: b64(pattern(32)) }),
    ],
  ])('%s as the first frame: malformed-frame, reject{malformed}, link closed', async (_label, payload) => {
    const rig = makeRig();
    const spy = countingCrypto(rig.hostCrypto);
    const { pending, script } = realHost(rig, { crypto: spy.crypto });
    await script.sendFrame(payload);
    expect(codeOf(await pending)).toBe('malformed-frame');
    expect(spy.total()).toBe(0);
    await settle();
    expect(rejectFrame(script.frames, 0).reason).toBe('malformed');
    expect(rig.hostEnd.closeCalls).toBe(1);
  });

  it('a second hello after hello-ack is an unexpected message, not a restart', async () => {
    const rig = makeRig();
    const { pending, script } = realHost(rig);
    await script.sendHandshake(hello());
    await script.nextHandshake();
    await script.sendHandshake(hello({ nonce: b64(pattern(16, 9)) }));
    expect(codeOf(await pending)).toBe('malformed-frame');
  });

  it('data after a failure is ignored: nothing more is sent and nothing throws', async () => {
    const rig = makeRig();
    const { pending, script } = realHost(rig);
    await script.sendFrame(utf8Encode('garbage'));
    await pending;
    await settle();
    const framesAfterFailure = script.frames.length;
    rig.hostEnd.inject(encodeFrame(utf8Encode('more garbage')));
    await settle();
    expect(script.frames.length).toBe(framesAfterFailure);
  });

  it('frames before authentication are capped at 1024 bytes: 1024 passes, 1025 is frame-too-large', async () => {
    const pad = (total: number): Uint8Array => {
      const base = `{"type":"hello","v":1,"pairId":"${PAIR_ID}","nonce":"${b64(NONCE_G)}","pad":"`;
      const filler = total - base.length - 2;
      return utf8Encode(`${base}${'x'.repeat(filler)}"}`);
    };
    const exact = pad(MAX_HANDSHAKE_FRAME_BYTES);
    expect(exact.length).toBe(MAX_HANDSHAKE_FRAME_BYTES);
    const okRig = makeRig();
    const ok = realHost(okRig);
    await ok.script.sendFrame(exact);
    const ack = await ok.script.nextHandshake();
    expect(ack.type).toBe('hello-ack'); // the 1024-byte hello was accepted and answered

    const tooBigRig = makeRig();
    const tooBig = realHost(tooBigRig);
    await tooBig.script.sendFrame(pad(MAX_HANDSHAKE_FRAME_BYTES + 1));
    expect(codeOf(await tooBig.pending)).toBe('frame-too-large');
    await settle();
    expect(rejectFrame(tooBig.script.frames, 0).reason).toBe('malformed');
  });

  it('a huge declared length is refused from the header alone, without waiting for the payload', async () => {
    const rig = makeRig();
    const { pending, script } = realHost(rig);
    await script.sendRaw(Uint8Array.of(0xff, 0xff, 0xff, 0xff));
    expect(codeOf(await pending)).toBe('frame-too-large');
  });

  it('a zero-length frame is malformed-frame', async () => {
    const rig = makeRig();
    const { pending, script } = realHost(rig);
    await script.sendRaw(new Uint8Array(4));
    expect(codeOf(await pending)).toBe('malformed-frame');
  });

  it('a nonce equal to the host`s own fresh nonce is refused as bad-proof (collision / broken random source)', async () => {
    const rig = makeRig();
    const forced = createCryptoProvider(scriptedRandomBytes([NONCE_G])); // the host will draw exactly NONCE_G
    const { pending, script } = realHost(rig, { crypto: forced });
    await script.sendHandshake(hello());
    expect(codeOf(await pending)).toBe('bad-proof');
    await settle();
    expect(rejectFrame(script.frames, 0).reason).toBe('bad-proof');
  });

  it('a host whose random source is broken fails closed instead of using a weak nonce', async () => {
    const rig = makeRig();
    const broken = { ...rig.hostCrypto, randomBytes: () => new Uint8Array(3) };
    const { pending, script } = realHost(rig, { crypto: broken });
    await script.sendHandshake(hello());
    const result = await pending;
    expect(result.ok).toBe(false);
    expect(rig.hostEnd.closeCalls).toBe(1);
    expect(script.frames.length).toBe(0); // no hello-ack with a bogus nonce
  });

  it('a hello followed by silence is the handshake timeout, not a hang (injected timers)', async () => {
    const timers = new ManualTimers();
    const rig = makeRig({ timers });
    const { pending, script } = realHost(rig);
    await script.sendHandshake(hello());
    await script.nextHandshake();
    timers.advance(DEFAULT_HANDSHAKE_TIMEOUT_MS);
    expect(codeOf(await pending)).toBe('handshake-timeout');
  });
});

describe('a scripted host breaking the protocol against a real guest', () => {
  it('the first frame of the guest is a well-formed hello with v=1, the pair id and a fresh 16-byte nonce', async () => {
    const rig = makeRig();
    const { script } = realGuest(rig);
    const first = await script.nextHandshake();
    expect(first.type).toBe('hello');
    if (first.type !== 'hello') return;
    expect(first.v).toBe(1);
    expect(first.pairId).toBe(PAIR_ID);
    expect(first.nonce.length).toBe(16);
    expect(utf8Decode(script.frames[0] ?? new Uint8Array())).toBe(
      `{"type":"hello","v":1,"pairId":"${PAIR_ID}","nonce":"${b64(first.nonce)}"}`,
    );
  });

  it('a hello-ack with a proof from the wrong secret: bad-proof, reject{bad-proof}, and `auth` is never sent', async () => {
    const rig = makeRig();
    const { pending, script } = realGuest(rig);
    const first = await script.nextHandshake();
    if (first.type !== 'hello') throw new Error('expected hello');
    await script.sendHandshake({
      type: 'hello-ack',
      v: 1,
      nonce: b64(NONCE_H),
      proof: b64(hostProofFor(NONCE_H, OTHER_SECRET, first.nonce)),
    });
    expect(codeOf(await pending)).toBe('bad-proof');
    await settle();
    expect(script.frames.length).toBe(2);
    expect(rejectFrame(script.frames, 1).reason).toBe('bad-proof');
    expect(rig.guestEnd.closeCalls).toBe(1);
  });

  it('REFLECTION: the guest`s own hello nonce echoed back as the host nonce is refused even with a valid proof', async () => {
    const rig = makeRig();
    const { pending, script } = realGuest(rig);
    const first = await script.nextHandshake();
    if (first.type !== 'hello') throw new Error('expected hello');
    // An attacker who somehow holds a valid proof for (G, G) still cannot make the guest talk to itself.
    await script.sendHandshake({
      type: 'hello-ack',
      v: 1,
      nonce: b64(first.nonce),
      proof: b64(hostProofFor(first.nonce, SECRET, first.nonce)),
    });
    expect(codeOf(await pending)).toBe('bad-proof');
    await settle();
    expect(script.frames.length).toBe(2); // hello + reject, no `auth`
  });

  it('REFLECTION: the guest`s own hello bounced back verbatim is an unexpected message', async () => {
    const rig = makeRig();
    const { pending, script } = realGuest(rig);
    await script.nextHandshake();
    await script.sendFrame(script.frames[0] ?? new Uint8Array());
    expect(codeOf(await pending)).toBe('malformed-frame');
  });

  it('REFLECTION: a guest-style proof (label "guest", swapped nonces) offered as the host proof is refused', async () => {
    const rig = makeRig();
    const { pending, script } = realGuest(rig);
    const first = await script.nextHandshake();
    if (first.type !== 'hello') throw new Error('expected hello');
    await script.sendHandshake({
      type: 'hello-ack',
      v: 1,
      nonce: b64(NONCE_H),
      proof: b64(guestProofFor(NONCE_H, SECRET, first.nonce)),
    });
    expect(codeOf(await pending)).toBe('bad-proof');
  });

  it.each([
    ['an auth message', (): HandshakeMessage => ({ type: 'auth', proof: b64(pattern(32)) })],
    ['another hello', (): HandshakeMessage => hello()],
  ])('%s instead of hello-ack is unexpected', async (_label, message) => {
    const rig = makeRig();
    const { pending, script } = realGuest(rig);
    await script.nextHandshake();
    await script.sendHandshake(message());
    expect(codeOf(await pending)).toBe('malformed-frame');
  });

  it('a hello-ack with a malformed nonce is refused before any proof check', async () => {
    const rig = makeRig();
    const spy = countingCrypto(rig.guestCrypto);
    const { pending, script } = realGuest(rig, { crypto: spy.crypto });
    await script.nextHandshake();
    const callsAfterHello = spy.total();
    await script.sendFrame(
      utf8Encode(`{"type":"hello-ack","v":1,"nonce":"short","proof":"${b64(pattern(32))}"}`),
    );
    expect(codeOf(await pending)).toBe('malformed-frame');
    expect(spy.total()).toBe(callsAfterHello);
  });

  describe('instead of `ready`', () => {
    async function afterAuth() {
      const rig = makeRig();
      const { pending, script } = realGuest(rig);
      const first = await script.nextHandshake();
      if (first.type !== 'hello') throw new Error('expected hello');
      await script.sendHandshake({
        type: 'hello-ack',
        v: 1,
        nonce: b64(NONCE_H),
        proof: b64(hostProofFor(NONCE_H, SECRET, first.nonce)),
      });
      await script.nextHandshake(); // the guest's auth
      return { rig, pending, script, keys: keysFor(NONCE_H, SECRET, first.nonce) };
    }

    it('the real host answers a proof it dislikes with a plain reject: an unauthenticated hint that ends the handshake', async () => {
      const { pending, script, rig } = await afterAuth();
      await script.sendHandshake({ type: 'reject', reason: 'bad-proof' });
      expect(codeOf(await pending)).toBe('bad-proof');
      expect(rig.guestEnd.closeCalls).toBe(1);
      await settle();
      expect(script.frames.length).toBe(2); // hello, auth: a reject is never answered with a reject
    });

    it('a ready sealed with the wrong key is bad-mac', async () => {
      const { pending, script } = await afterAuth();
      await script.sendFrame(
        sealFrame(scriptCrypto, pattern(32, 1), 0, encodeSessionMessage({ type: 'ready' })),
      );
      expect(codeOf(await pending)).toBe('bad-mac');
    });

    it('a ready sealed with the right key but the wrong counter is bad-mac', async () => {
      const { pending, script, keys } = await afterAuth();
      await script.sendFrame(
        sealFrame(scriptCrypto, keys.hostToGuest, 1, encodeSessionMessage({ type: 'ready' })),
      );
      expect(codeOf(await pending)).toBe('bad-mac');
    });

    it('a ready sealed with the GUEST->HOST key (a reflected direction) is bad-mac', async () => {
      const { pending, script, keys } = await afterAuth();
      await script.sendFrame(
        sealFrame(scriptCrypto, keys.guestToHost, 0, encodeSessionMessage({ type: 'ready' })),
      );
      expect(codeOf(await pending)).toBe('bad-mac');
    });

    it('an authentic first message that is not `ready` is malformed-frame', async () => {
      const { pending, script, keys } = await afterAuth();
      await script.sendFrame(authenticated(keys.hostToGuest, 0, ping(1)));
      expect(codeOf(await pending)).toBe('malformed-frame');
    });

    it('an authentic first frame whose body is garbage is malformed-frame', async () => {
      const { pending, script, keys } = await afterAuth();
      await script.sendFrame(sealFrame(scriptCrypto, keys.hostToGuest, 0, utf8Encode('not json at all')));
      expect(codeOf(await pending)).toBe('malformed-frame');
    });

    it('a frame too short to carry a tag is malformed-frame', async () => {
      const { pending, script } = await afterAuth();
      await script.sendFrame(new Uint8Array(10).fill(1));
      expect(codeOf(await pending)).toBe('malformed-frame');
    });

    it('silence is the handshake timeout', async () => {
      const timers = new ManualTimers();
      const rig = makeRig({ timers });
      const { pending, script } = realGuest(rig);
      const first = await script.nextHandshake();
      if (first.type !== 'hello') throw new Error('expected hello');
      await script.sendHandshake({
        type: 'hello-ack',
        v: 1,
        nonce: b64(NONCE_H),
        proof: b64(hostProofFor(NONCE_H, SECRET, first.nonce)),
      });
      await script.nextHandshake();
      timers.advance(DEFAULT_HANDSHAKE_TIMEOUT_MS);
      expect(codeOf(await pending)).toBe('handshake-timeout');
    });

    it('control: the correct ready completes the handshake', async () => {
      const rig = makeRig();
      const { guest } = await hostHandshake(rig);
      expect(guest.role).toBe('guest');
    });
  });
});

describe('`reject` is an unauthenticated hint and nothing else', () => {
  const MAPPING: [RejectReason, ProtocolErrorCode][] = [
    ['unsupported-version', 'unsupported-version'],
    ['unknown-pair', 'unknown-pair'],
    ['bad-proof', 'bad-proof'],
    ['busy', 'busy'],
    ['malformed', 'malformed-frame'],
  ];

  it.each(MAPPING)(
    'guest awaiting hello-ack: reject{%s} ends the handshake with %s',
    async (reason, code) => {
      const rig = makeRig();
      const { pending, script } = realGuest(rig);
      await script.nextHandshake();
      await script.sendHandshake({ type: 'reject', reason });
      expect(codeOf(await pending)).toBe(code);
      expect(rig.guestEnd.closeCalls).toBe(1);
      await settle();
      expect(script.frames.length).toBe(1); // hello only: a reject is never answered
    },
  );

  it.each(MAPPING)('host awaiting hello: reject{%s} ends the handshake with %s', async (reason, code) => {
    const rig = makeRig();
    const spy = countingCrypto(rig.hostCrypto);
    const { pending, script } = realHost(rig, { crypto: spy.crypto });
    await script.sendHandshake({ type: 'reject', reason });
    expect(codeOf(await pending)).toBe(code);
    expect(spy.total()).toBe(0);
    await settle();
    expect(script.frames.length).toBe(0);
  });

  it.each(MAPPING)('host awaiting auth: reject{%s} ends the handshake with %s', async (reason, code) => {
    const rig = makeRig();
    const { pending, script } = realHost(rig);
    await script.sendHandshake(hello());
    await script.nextHandshake();
    await script.sendHandshake({ type: 'reject', reason });
    expect(codeOf(await pending)).toBe(code);
    await settle();
    expect(script.frames.length).toBe(1); // hello-ack only
  });

  it('error messages say the hint is unauthenticated', async () => {
    const rig = makeRig();
    const { pending, script } = realGuest(rig);
    await script.nextHandshake();
    await script.sendHandshake({ type: 'reject', reason: 'bad-proof' });
    const result = await pending;
    expect(result.ok ? '' : (result.error as Error).message).toContain('unauthenticated hint');
  });

  it('a forged reject can only end a handshake, never complete or alter one', async () => {
    const rig = makeRig();
    const [guestResult, hostResult] = await Promise.all([
      outcome(establishSecureChannel(rig.guestEnd, rig.guestOptions())),
      outcome(establishSecureChannel(rig.hostEnd, rig.hostOptions())),
    ]);
    expect(guestResult.ok && hostResult.ok).toBe(true); // control: the honest run succeeds
    // A reject injected into an honest run before it completes ends it...
    const rig2 = makeRig({
      pipe: {
        tapBtoA: (data, index) =>
          index === 0 ? [encodeFrame(encodeHandshakeMessage({ type: 'reject', reason: 'busy' }))] : [data],
      },
    });
    const [g, h] = await Promise.all([
      outcome(establishSecureChannel(rig2.guestEnd, rig2.guestOptions())),
      outcome(establishSecureChannel(rig2.hostEnd, rig2.hostOptions())),
    ]);
    expect(codeOf(g)).toBe('busy');
    expect(h.ok).toBe(false); // the guest hung up, so the host cannot finish either
  });

  it('after the handshake a plain reject frame is just a forged frame: bad-mac, channel closed', async () => {
    const rig = makeRig();
    const { guest, script } = await hostHandshake(rig);
    const reasons = closeReasons(guest);
    await script.sendHandshake({ type: 'reject', reason: 'bad-proof' });
    await settle();
    expect(reasons).toEqual(['bad-mac']);
  });

  it('a plain reject frame sent to an established host is refused too (bad-mac, or malformed-frame when too short for a tag)', async () => {
    for (const [reason, expected] of [
      ['bad-proof', 'bad-mac'],
      ['busy', 'malformed-frame'],
    ] as const) {
      const rig = makeRig();
      const { host, script } = await guestHandshake(rig);
      const reasons = closeReasons(host);
      await script.sendHandshake({ type: 'reject', reason });
      await settle();
      expect(reasons).toEqual([expected]);
    }
  });
});

describe('post-handshake attacks against an established real channel', () => {
  it('control: in-order authenticated frames from the peer are delivered', async () => {
    const rig = makeRig();
    const { host, script, keys } = await guestHandshake(rig);
    const got = collect(host);
    for (let counter = 0; counter < 5; counter++) {
      await script.sendFrame(authenticated(keys.guestToHost, counter, ping(counter)));
    }
    await settle();
    expect(got).toEqual([0, 1, 2, 3, 4].map(ping));
  });

  it('REPLAY of a captured frame closes the channel with bad-mac', async () => {
    const rig = makeRig();
    const { host, script, keys } = await guestHandshake(rig);
    const got = collect(host);
    const reasons = closeReasons(host);
    const captured = authenticated(keys.guestToHost, 0, ping(1));
    await script.sendFrame(captured);
    await script.sendFrame(authenticated(keys.guestToHost, 1, ping(2)));
    await script.sendFrame(captured); // the replay
    await settle();
    expect(got).toEqual([ping(1), ping(2)]);
    expect(reasons).toEqual(['bad-mac']);
    expect(rig.hostEnd.closeCalls).toBe(1);
  });

  it('REORDERED frames (1 before 0) are refused', async () => {
    const rig = makeRig();
    const { host, script, keys } = await guestHandshake(rig);
    const got = collect(host);
    const reasons = closeReasons(host);
    await script.sendFrame(authenticated(keys.guestToHost, 1, ping(2)));
    await script.sendFrame(authenticated(keys.guestToHost, 0, ping(1)));
    await settle();
    expect(got).toEqual([]);
    expect(reasons).toEqual(['bad-mac']);
  });

  it('a DROPPED frame (0 then 2) is detected at the next frame', async () => {
    const rig = makeRig();
    const { host, script, keys } = await guestHandshake(rig);
    const got = collect(host);
    const reasons = closeReasons(host);
    await script.sendFrame(authenticated(keys.guestToHost, 0, ping(0)));
    await script.sendFrame(authenticated(keys.guestToHost, 2, ping(2)));
    await settle();
    expect(got).toEqual([ping(0)]);
    expect(reasons).toEqual(['bad-mac']);
  });

  it('a frame sealed with the HOST->GUEST key (reflection of the host`s own direction) is refused', async () => {
    const rig = makeRig();
    const { host, script, keys } = await guestHandshake(rig);
    const reasons = closeReasons(host);
    await script.sendFrame(authenticated(keys.hostToGuest, 0, ping(1)));
    await settle();
    expect(reasons).toEqual(['bad-mac']);
  });

  it('REFLECTION: whatever the host itself sent, bounced back at it, is refused', async () => {
    const rig = makeRig();
    const { host, script } = await guestHandshake(rig);
    const reasons = closeReasons(host);
    const got = collect(host);
    await host.send(ping(5));
    await settle();
    const hostFrame = script.frames[script.frames.length - 1] ?? new Uint8Array(); // the host's ping, as the peer saw it
    await script.sendFrame(hostFrame);
    await settle();
    expect(got).toEqual([]);
    expect(reasons).toEqual(['bad-mac']);
  });

  it('REFLECTION (guest side): a frame the guest sent, bounced back to it, is refused', async () => {
    const rig = makeRig();
    const { guest, script } = await hostHandshake(rig);
    const reasons = closeReasons(guest);
    const got = collect(guest);
    await guest.send(ping(5));
    await settle();
    const guestFrame = script.frames[script.frames.length - 1] ?? new Uint8Array();
    await script.sendFrame(guestFrame);
    await settle();
    expect(got).toEqual([]);
    expect(reasons).toEqual(['bad-mac']);
  });

  it('every single-bit flip of an authenticated frame is refused (tag and body, exhaustive)', async () => {
    const reference = makeRig({ seed: 31 });
    const good = await guestHandshake(reference);
    const frame = authenticated(good.keys.guestToHost, 0, {
      type: 'peer-state',
      name: 'A',
      muted: false,
      headsetConnected: true,
      batteryPct: 5,
      charging: null,
      interruption: 'none',
    });
    await good.host.close();
    let flips = 0;
    for (let byte = 0; byte < frame.length; byte++) {
      for (let bit = 0; bit < 8; bit++) {
        const rig = makeRig({ seed: 31 }); // same seed: same nonces, so the same keys as above
        const { host, script, keys } = await guestHandshake(rig);
        expect(bytesEqual(keys.guestToHost, good.keys.guestToHost)).toBe(true);
        const got = collect(host);
        const reasons = closeReasons(host);
        const flipped = new Uint8Array(frame);
        flipped[byte] = (flipped[byte] ?? 0) ^ (1 << bit);
        await script.sendFrame(flipped);
        await settle(1);
        expect(got.length).toBe(0);
        expect(reasons).toEqual(['bad-mac']);
        flips += 1;
      }
    }
    expect(flips).toBe(frame.length * 8);
  }, 60_000);

  it('control for the flip test: the unmodified frame IS accepted under the same seed', async () => {
    const rig = makeRig({ seed: 31 });
    const { host, script, keys } = await guestHandshake(rig);
    const got = collect(host);
    await script.sendFrame(authenticated(keys.guestToHost, 0, ping(1)));
    await settle();
    expect(got).toEqual([ping(1)]);
  });

  it('CROSS-CONNECTION REPLAY: a frame captured on one connection is refused on the next (fresh nonces)', async () => {
    const first = makeRig({ seed: 40 });
    const a = await guestHandshake(first);
    const captured = authenticated(a.keys.guestToHost, 0, ping(1));
    const second = makeRig({ seed: 41 }); // different host randomness: a fresh nonceHost
    const b = await guestHandshake(second);
    expect(bytesEqual(a.keys.guestToHost, b.keys.guestToHost)).toBe(false);
    const reasons = closeReasons(b.host);
    const got = collect(b.host);
    await b.script.sendFrame(captured);
    await settle();
    expect(got).toEqual([]);
    expect(reasons).toEqual(['bad-mac']);
  });

  it('REPLAYED HANDSHAKE: a recorded hello + auth transcript fails against a host with a fresh nonce', async () => {
    const recorded = makeRig({ seed: 50 });
    await guestHandshake(recorded);
    const [recordedHello, recordedAuth] = recorded.guestEnd.sent;
    expect(recordedAuth).toBeDefined();
    const fresh = makeRig({ seed: 51 });
    const { pending, script } = realHost(fresh);
    await script.sendRaw(recordedHello ?? new Uint8Array());
    await script.nextHandshake();
    await script.sendRaw(recordedAuth ?? new Uint8Array());
    expect(codeOf(await pending)).toBe('bad-proof');
  });

  it('control for the replay test: against a host that draws the SAME nonce the recording would be valid', async () => {
    const recorded = makeRig({ seed: 50 });
    await guestHandshake(recorded);
    const [recordedHello, recordedAuth] = recorded.guestEnd.sent;
    const same = makeRig({ seed: 50 });
    const { pending, script } = realHost(same);
    await script.sendRaw(recordedHello ?? new Uint8Array());
    await script.nextHandshake();
    await script.sendRaw(recordedAuth ?? new Uint8Array());
    expect((await pending).ok).toBe(true);
  });

  it('a third party that does not know the secret cannot make the host accept anything', async () => {
    // An eavesdropper sees pairId, both nonces and the host proof, but has no secret: it can only guess.
    const guessesFor = (ack: ParsedHelloAck): Uint8Array[] => [
      ack.proof, // the host's own proof, reflected
      new Uint8Array(32),
      guestProofFor(ack.nonce, OTHER_SECRET),
      guestProofFor(NONCE_G, SECRET, ack.nonce), // arguments swapped
    ];
    for (let which = 0; which < 4; which++) {
      const rig = makeRig();
      const { pending, script } = realHost(rig);
      await script.sendHandshake(hello());
      const ack = (await script.nextHandshake()) as ParsedHelloAck;
      await script.sendHandshake({ type: 'auth', proof: b64(guessesFor(ack)[which] ?? new Uint8Array(32)) });
      expect(codeOf(await pending)).toBe('bad-proof');
    }
  });

  it('close-on-MAC-failure also releases the keys: the channel cannot be revived by later valid frames', async () => {
    const rig = makeRig();
    const { host, script, keys } = await guestHandshake(rig);
    const got = collect(host);
    await script.sendFrame(authenticated(pattern(32, 3), 0, ping(1))); // forged
    await settle();
    rig.hostEnd.inject(encodeFrame(authenticated(keys.guestToHost, 0, ping(2)))); // would have been valid
    await settle();
    expect(got).toEqual([]);
    const error = await host.send(ping(3)).catch((e: unknown) => e);
    expect((error as ProtocolError).code).toBe('closed');
  });
});

describe('nonce hygiene', () => {
  it('every handshake attempt uses fresh randomness: 20 consecutive guests never repeat a nonce', async () => {
    const rig = makeRig({ seed: 60 });
    const seen = new Set<string>();
    for (let attempt = 0; attempt < 20; attempt++) {
      const pipe = makeRig({ seed: 60 }); // reuse the same crypto instance across attempts
      const guest = outcome(
        establishSecureChannel(pipe.guestEnd, pipe.guestOptions({ crypto: rig.guestCrypto })),
      );
      const script = new RawPeer(pipe.hostEnd);
      const first = await script.nextHandshake();
      if (first.type !== 'hello') throw new Error('expected hello');
      seen.add(toHex(first.nonce));
      await script.sendHandshake({ type: 'reject', reason: 'busy' });
      await guest;
    }
    expect(seen.size).toBe(20);
  });

  it('the guest nonce is not predictable from the pair id or the secret (it comes only from the injected source)', async () => {
    const a = makeRig({ seed: 70 });
    const b = makeRig({ seed: 71 });
    const ga = realGuest(a);
    const gb = realGuest(b);
    const na = await ga.script.nextHandshake();
    const nb = await gb.script.nextHandshake();
    if (na.type !== 'hello' || nb.type !== 'hello') throw new Error('expected hello');
    expect(toHex(na.nonce)).not.toBe(toHex(nb.nonce));
    await ga.script.sendHandshake({ type: 'reject', reason: 'busy' });
    await gb.script.sendHandshake({ type: 'reject', reason: 'busy' });
    await Promise.all([ga.pending, gb.pending]);
  });
});

// ==================================================================================================================

describe('no secret or key material ever appears in an error message', () => {
  /** Every failure scenario above, reduced to the error it produces. Each returns the Outcome and extra secrets. */
  const scenarios: Record<string, () => Promise<Outcome>> = {
    'wrong secret (guest)': async () => {
      const rig = makeRig();
      const [guest] = await Promise.all([
        outcome(establishSecureChannel(rig.guestEnd, rig.guestOptions({ secret: OTHER_SECRET }))),
        outcome(establishSecureChannel(rig.hostEnd, rig.hostOptions())),
      ]);
      return guest;
    },
    'wrong secret (host)': async () => {
      const rig = makeRig();
      const [, host] = await Promise.all([
        outcome(establishSecureChannel(rig.guestEnd, rig.guestOptions())),
        outcome(establishSecureChannel(rig.hostEnd, rig.hostOptions({ secret: OTHER_SECRET }))),
      ]);
      return host;
    },
    'wrong pair id': async () => {
      const rig = makeRig();
      const [, host] = await Promise.all([
        outcome(establishSecureChannel(rig.guestEnd, rig.guestOptions({ pairId: OTHER_PAIR_ID }))),
        outcome(establishSecureChannel(rig.hostEnd, rig.hostOptions())),
      ]);
      return host;
    },
    'bad guest proof': async () => {
      const rig = makeRig();
      const { pending, script } = realHost(rig);
      await script.sendHandshake(hello());
      const ack = (await script.nextHandshake()) as ParsedHelloAck;
      await script.sendHandshake({ type: 'auth', proof: b64(guestProofFor(ack.nonce, OTHER_SECRET)) });
      return pending;
    },
    'unsupported version': async () => {
      const rig = makeRig();
      const { pending, script } = realHost(rig);
      await script.sendHandshake(hello({ v: 9 }));
      return pending;
    },
    'garbage frame': async () => {
      const rig = makeRig();
      const { pending, script } = realHost(rig);
      await script.sendFrame(utf8Encode('{"secret":"leak?"'));
      return pending;
    },
    'oversized frame': async () => {
      const rig = makeRig();
      const { pending, script } = realHost(rig);
      await script.sendRaw(Uint8Array.of(0, 0xff, 0xff, 0xff));
      return pending;
    },
    'bad ready mac': async () => {
      const rig = makeRig();
      const { pending, script } = realGuest(rig);
      const first = await script.nextHandshake();
      if (first.type !== 'hello') throw new Error('expected hello');
      await script.sendHandshake({
        type: 'hello-ack',
        v: 1,
        nonce: b64(NONCE_H),
        proof: b64(hostProofFor(NONCE_H, SECRET, first.nonce)),
      });
      await script.nextHandshake();
      await script.sendFrame(
        sealFrame(scriptCrypto, pattern(32, 1), 0, encodeSessionMessage({ type: 'ready' })),
      );
      return pending;
    },
    'peer reject': async () => {
      const rig = makeRig();
      const { pending, script } = realGuest(rig);
      await script.nextHandshake();
      await script.sendHandshake({ type: 'reject', reason: 'bad-proof' });
      return pending;
    },
    timeout: async () => {
      const timers = new ManualTimers();
      const rig = makeRig({ timers });
      const pending = outcome(establishSecureChannel(rig.guestEnd, rig.guestOptions()));
      await settle();
      timers.advance(DEFAULT_HANDSHAKE_TIMEOUT_MS);
      return pending;
    },
    'link closed': async () => {
      const rig = makeRig();
      const pending = outcome(establishSecureChannel(rig.guestEnd, rig.guestOptions()));
      await settle();
      await rig.hostEnd.close();
      return pending;
    },
    'bad options': async () => {
      const rig = makeRig();
      return outcome(
        establishSecureChannel(
          rig.guestEnd,
          rig.guestOptions({ secret: new Uint8Array(SECRET.subarray(0, 31)) }),
        ),
      );
    },
  };

  it('scans the message, stack, string and JSON form of every failure for secrets, keys, proofs, nonces', async () => {
    // Everything secret or key-derived in play in these scenarios (fixed fixtures, so they can be recomputed).
    const readyFrame = authenticated(keysFor(NONCE_H).hostToGuest, 0, { type: 'ready' });
    const secretsInPlay: Record<string, Uint8Array> = {
      secret: SECRET,
      'other secret': OTHER_SECRET,
      'auth key': deriveAuthKey(scriptCrypto, SECRET),
      'other auth key': deriveAuthKey(scriptCrypto, OTHER_SECRET),
      'guest->host key': keysFor(NONCE_H).guestToHost,
      'host->guest key': keysFor(NONCE_H).hostToGuest,
      'host proof': hostProofFor(NONCE_H),
      'guest proof': guestProofFor(NONCE_H),
      'wrong-secret guest proof': guestProofFor(NONCE_H, OTHER_SECRET),
      'ready tag': readyFrame.subarray(0, 32),
      'guest nonce': NONCE_G,
      'host nonce': NONCE_H,
      // The exact (deterministic) nonces the rig's random sources produce.
      'rig guest nonce': createCryptoProvider(seededRandomBytes(1001)).randomBytes(16),
      'rig host nonce': createCryptoProvider(seededRandomBytes(1002)).randomBytes(16),
    };

    let failures = 0;
    for (const [name, run] of Object.entries(scenarios)) {
      const result = await run();
      expect([name, result.ok]).toEqual([name, false]);
      if (result.ok) continue;
      failures += 1;
      const texts: Record<string, string> = {};
      for (const [part, text] of Object.entries(describeError(result.error)))
        texts[`${name} / ${part}`] = text;
      assertNoLeak(texts, secretsInPlay);
    }
    expect(failures).toBe(Object.keys(scenarios).length);
  });

  it('an error message is built from static text and small integers only: it never contains wire strings', async () => {
    const MARKER = 'Q9-MARKER-4821';
    const rig = makeRig();
    const { pending, script } = realHost(rig);
    await script.sendFrame(utf8Encode(`{"type":"hello","v":1,"pairId":"${MARKER}","nonce":"${MARKER}"}`));
    const result = await pending;
    expect(result.ok).toBe(false);
    if (result.ok) return;
    for (const text of Object.values(describeError(result.error))) expect(text.includes(MARKER)).toBe(false);
  });

  it('an established channel failure (bad-mac) carries no key material either', async () => {
    const rig = makeRig();
    const { host, script, keys } = await guestHandshake(rig);
    const reasons: string[] = [];
    host.onClose((reason) => reasons.push(reason));
    await script.sendFrame(authenticated(pattern(32, 3), 0, ping(1)));
    await settle();
    const error = await host.send(ping(1)).catch((e: unknown) => e);
    const texts = describeError(error);
    assertNoLeak(
      { ...texts, reasons: reasons.join('|') },
      { secret: SECRET, 'guest->host key': keys.guestToHost, 'host->guest key': keys.hostToGuest },
    );
    expect(reasons).toEqual(['bad-mac']);
  });
});

// ==================================================================================================================

describe('every ProtocolErrorCode is produced by a real scenario', () => {
  const CODES: Record<ProtocolErrorCode, () => Promise<Outcome | { code: string }>> = {
    'handshake-timeout': async () => {
      const timers = new ManualTimers();
      const rig = makeRig({ timers });
      const pending = outcome(establishSecureChannel(rig.hostEnd, rig.hostOptions()));
      await settle();
      timers.advance(DEFAULT_HANDSHAKE_TIMEOUT_MS);
      return pending;
    },
    'unsupported-version': async () => {
      const rig = makeRig();
      const { pending, script } = realHost(rig);
      await script.sendHandshake(hello({ v: 2 }));
      return pending;
    },
    'unknown-pair': async () => {
      const rig = makeRig();
      const { pending, script } = realHost(rig);
      await script.sendHandshake(hello({ pairId: OTHER_PAIR_ID }));
      return pending;
    },
    'bad-proof': async () => {
      const rig = makeRig();
      const [guest] = await Promise.all([
        outcome(establishSecureChannel(rig.guestEnd, rig.guestOptions({ secret: OTHER_SECRET }))),
        outcome(establishSecureChannel(rig.hostEnd, rig.hostOptions())),
      ]);
      return guest;
    },
    'bad-mac': async () => {
      const rig = makeRig();
      const { host, script } = await guestHandshake(rig);
      const reasons = closeReasons(host);
      await script.sendFrame(authenticated(pattern(32, 3), 0, ping(1)));
      await settle();
      return { code: reasons[0] ?? 'none' };
    },
    'malformed-frame': async () => {
      const rig = makeRig();
      const { pending, script } = realHost(rig);
      await script.sendFrame(utf8Encode('not json'));
      return pending;
    },
    'frame-too-large': async () => {
      const rig = makeRig();
      const { pending, script } = realHost(rig);
      await script.sendRaw(Uint8Array.of(0x7f, 0xff, 0xff, 0xff));
      return pending;
    },
    busy: async () => {
      const rig = makeRig();
      const { pending, script } = realGuest(rig);
      await script.nextHandshake();
      await script.sendHandshake({ type: 'reject', reason: 'busy' });
      return pending;
    },
    closed: async () => {
      const rig = makeRig();
      const pending = outcome(establishSecureChannel(rig.guestEnd, rig.guestOptions()));
      await settle();
      await rig.hostEnd.close();
      return pending;
    },
  };

  it.each(Object.keys(CODES) as ProtocolErrorCode[])('%s', async (code) => {
    const scenario = CODES[code];
    const result = await scenario();
    const observed = 'code' in result ? result.code : codeOf(result);
    expect(observed).toBe(code);
  });

  it('the secure channel`s send() rejects with `closed` once the channel is closed', async () => {
    const rig = makeRig();
    const [guest] = await Promise.all([
      establishSecureChannel(rig.guestEnd, rig.guestOptions()),
      establishSecureChannel(rig.hostEnd, rig.hostOptions()),
    ]);
    await guest.close();
    const error = await guest.send(ping(1)).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ProtocolError);
    expect((error as ProtocolError).code).toBe('closed');
  });

  it('every established-channel failure code reaches onClose as that code', async () => {
    const cases: [string, () => Uint8Array][] = [
      ['bad-mac', () => encodeFrame(authenticated(pattern(32, 3), 0, ping(1)))],
      ['malformed-frame', () => encodeFrame(new Uint8Array(10).fill(1))],
      ['frame-too-large', () => Uint8Array.of(0, 0x10, 0, 1)],
    ];
    for (const [expected, build] of cases) {
      const rig = makeRig();
      const { host, script } = await guestHandshake(rig);
      const reasons = closeReasons(host);
      await script.sendRaw(build());
      await settle();
      expect(reasons).toEqual([expected]);
    }
  });
});

describe('interplay: concatenated frames from a scripted peer', () => {
  it('a hello and a bogus auth in one chunk: the host answers hello-ack, then refuses the auth', async () => {
    const rig = makeRig();
    const { pending, script } = realHost(rig);
    const together = concatBytes(
      encodeFrame(encodeHandshakeMessage(hello())),
      encodeFrame(encodeHandshakeMessage({ type: 'auth', proof: b64(pattern(32)) })),
    );
    await script.sendRaw(together);
    expect(codeOf(await pending)).toBe('bad-proof');
    await settle();
    expect(script.frames.length).toBe(2); // hello-ack, then reject{bad-proof}
  });

  it('tail bytes after a valid ready are routed to the new channel, not lost', async () => {
    const rig = makeRig();
    const { pending, script } = realGuest(rig);
    const first = await script.nextHandshake();
    if (first.type !== 'hello') throw new Error('expected hello');
    await script.sendHandshake({
      type: 'hello-ack',
      v: 1,
      nonce: b64(NONCE_H),
      proof: b64(hostProofFor(NONCE_H, SECRET, first.nonce)),
    });
    await script.nextHandshake();
    const keys = keysFor(NONCE_H, SECRET, first.nonce);
    await script.sendRaw(
      concatBytes(
        encodeFrame(authenticated(keys.hostToGuest, 0, { type: 'ready' })),
        encodeFrame(authenticated(keys.hostToGuest, 1, ping(77))),
        encodeFrame(authenticated(keys.hostToGuest, 2, ping(78))),
      ),
    );
    const result = await pending;
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const got = collect(result.channel);
    await settle();
    expect(got).toEqual([ping(77), ping(78)]);
  });

  it('a forged frame right behind `ready` fails the established guest immediately but the handshake result is the failure', async () => {
    const rig = makeRig();
    const { pending, script } = realGuest(rig);
    const first = await script.nextHandshake();
    if (first.type !== 'hello') throw new Error('expected hello');
    await script.sendHandshake({
      type: 'hello-ack',
      v: 1,
      nonce: b64(NONCE_H),
      proof: b64(hostProofFor(NONCE_H, SECRET, first.nonce)),
    });
    await script.nextHandshake();
    const keys = keysFor(NONCE_H, SECRET, first.nonce);
    await script.sendRaw(
      concatBytes(
        encodeFrame(authenticated(keys.hostToGuest, 0, { type: 'ready' })),
        encodeFrame(authenticated(pattern(32, 1), 1, ping(1))), // forged
      ),
    );
    const result = await pending;
    expect(codeOf(result)).toBe('bad-mac');
    expect(rig.guestEnd.closeCalls).toBe(1);
  });

  it('the parsed `ready` is a real SessionMessage with no payload', () => {
    expect(parseSessionMessage(encodeSessionMessage({ type: 'ready' }))).toEqual({ type: 'ready' });
  });
});
