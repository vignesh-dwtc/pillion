/// <reference types="node" />
import { afterEach, describe, expect, it } from '@jest/globals';
import { createHmac, hkdfSync } from 'node:crypto';

import type { Unsubscribe } from '../common/types';
import { base64urlEncode } from './base64url';
import { concatBytes } from './bytes';
import { MAX_FRAME_BYTES } from './constants';
import { establishSecureChannel } from './establish';
import { encodeFrame } from './frame';
import { DEFAULT_HANDSHAKE_TIMEOUT_MS } from './limits';
import type { SessionMessage } from './messages';
import { createCryptoProvider } from './noble';
import type { ByteChannel, ProtocolError, SecureChannel } from './secureChannel';
import { bytesEqual, pattern, toHex } from './testing/hex';
import { byteAtATime, createMemoryPipe, randomChunker, settle } from './testing/memoryPipe';
import { startReferenceGuest, startReferenceHost } from './testing/referencePeer';
import {
  OTHER_SECRET,
  PAIR_ID,
  SECRET,
  codeOf,
  countingCrypto,
  makeRig,
  outcome,
  type Rig,
} from './testing/rig';
import { mulberry32, randomInt, seededRandomBytes } from './testing/rng';
import { ManualTimers } from './testing/timers';

afterEach(async () => {
  // Let every pending microtask and a few macrotasks run so that an unhandled promise rejection anywhere in the
  // code under test surfaces here and fails the test that caused it.
  await settle();
});

const ping = (id: number): SessionMessage => ({ type: 'ping', id, t: id });

async function establishPair(rig: Rig): Promise<{ guest: SecureChannel; host: SecureChannel }> {
  const [guest, host] = await Promise.all([
    establishSecureChannel(rig.guestEnd, rig.guestOptions()),
    establishSecureChannel(rig.hostEnd, rig.hostOptions()),
  ]);
  return { guest, host };
}

function collect(channel: SecureChannel): SessionMessage[] {
  const messages: SessionMessage[] = [];
  channel.onMessage((message) => messages.push(message));
  return messages;
}

describe('establishSecureChannel: happy path', () => {
  it('completes the handshake and then carries authenticated messages both ways', async () => {
    const rig = makeRig();
    const { guest, host } = await establishPair(rig);
    expect(guest.role).toBe('guest');
    expect(host.role).toBe('host');
    const atHost = collect(host);
    const atGuest = collect(guest);
    await guest.send({
      type: 'peer-state',
      name: 'Pillion',
      muted: false,
      headsetConnected: true,
      batteryPct: 90,
      charging: false,
      interruption: 'none',
    });
    await host.send({ type: 'sdp', generation: 1, kind: 'offer', sdp: 'v=0\r\n' });
    await guest.send({ type: 'sdp', generation: 1, kind: 'answer', sdp: 'v=0\r\n' });
    await settle();
    expect(atHost.map((m) => m.type)).toEqual(['peer-state', 'sdp']);
    expect(atGuest.map((m) => m.type)).toEqual(['sdp']);
  });

  it('puts exactly hello, auth on the wire from the guest and hello-ack, ready from the host (4 handshake frames)', async () => {
    const rig = makeRig();
    await establishPair(rig);
    expect(rig.guestEnd.sent.length).toBe(2);
    expect(rig.hostEnd.sent.length).toBe(2);
  });

  it('the guest never sees the host`s `ready` as an application message, and the host sees nothing of the handshake', async () => {
    const rig = makeRig();
    const { guest, host } = await establishPair(rig);
    const atGuest = collect(guest);
    const atHost = collect(host);
    await settle();
    expect(atGuest).toEqual([]);
    expect(atHost).toEqual([]);
  });

  it('works when the link delivers synchronously inside send() (state is updated before any send)', async () => {
    const rig = makeRig({ pipe: { delivery: 'sync' } });
    const { guest, host } = await establishPair(rig);
    const atHost = collect(host);
    await guest.send(ping(1));
    expect(atHost).toEqual([ping(1)]);
  });

  it('works whichever side starts first (the host may be set up long after the guest sent hello)', async () => {
    const rig = makeRig();
    const guestPromise = establishSecureChannel(rig.guestEnd, rig.guestOptions());
    await settle(); // hello sits in the link's buffer: nobody listens on the host end yet
    const hostPromise = establishSecureChannel(rig.hostEnd, rig.hostOptions());
    const [guest, host] = await Promise.all([guestPromise, hostPromise]);
    const atHost = collect(host);
    await guest.send(ping(3));
    await settle();
    expect(atHost).toEqual([ping(3)]);
  });

  it('is repeatable: a fresh link and fresh nonces give a fresh, independent session every time', async () => {
    const seenHellos = new Set<string>();
    for (let attempt = 0; attempt < 5; attempt++) {
      const rig = makeRig({ seed: 100 + attempt });
      const { guest, host } = await establishPair(rig);
      const atHost = collect(host);
      await guest.send(ping(attempt));
      await settle();
      expect(atHost).toEqual([ping(attempt)]);
      seenHellos.add(toHex(rig.guestEnd.sent[0] ?? new Uint8Array()));
    }
    expect(seenHellos.size).toBe(5);
  });

  it('draws exactly one nonce per side', async () => {
    const rig = makeRig();
    const guestSpy = countingCrypto(rig.guestCrypto);
    const hostSpy = countingCrypto(rig.hostCrypto);
    const [guest, host] = await Promise.all([
      establishSecureChannel(rig.guestEnd, rig.guestOptions({ crypto: guestSpy.crypto })),
      establishSecureChannel(rig.hostEnd, rig.hostOptions({ crypto: hostSpy.crypto })),
    ]);
    expect(guestSpy.calls.randomBytes).toBe(1);
    expect(hostSpy.calls.randomBytes).toBe(1);
    await Promise.all([guest.close(), host.close()]);
  });

  it('compares proofs and tags only through the provider timingSafeEqual', async () => {
    const rig = makeRig();
    const guestSpy = countingCrypto(rig.guestCrypto);
    const hostSpy = countingCrypto(rig.hostCrypto);
    const [guest, host] = await Promise.all([
      establishSecureChannel(rig.guestEnd, rig.guestOptions({ crypto: guestSpy.crypto })),
      establishSecureChannel(rig.hostEnd, rig.hostOptions({ crypto: hostSpy.crypto })),
    ]);
    const atHost = collect(host);
    await guest.send(ping(1));
    await settle();
    expect(atHost.length).toBe(1);
    // Guest: nonce check + host proof + `ready` tag. Host: nonce check + guest proof + the ping tag.
    expect(guestSpy.calls.timingSafeEqual).toBe(3);
    expect(hostSpy.calls.timingSafeEqual).toBe(3);
  });

  it('every authentication decision is delegated to the provider: a comparator that says "equal" for 32-byte values lets mismatched secrets through', async () => {
    // Proves there is no hidden `===` on proofs or tags: with a (deliberately broken) comparator the wrong-secret
    // handshake completes, with the real one it fails. A genuinely constant-time provider is what protects them.
    const broken = (base: ReturnType<typeof makeRig>['guestCrypto']) => ({
      ...base,
      timingSafeEqual: (a: Uint8Array, b: Uint8Array) =>
        a.length === 32 ? true : base.timingSafeEqual(a, b),
    });
    const rig = makeRig();
    const [guest, host] = await Promise.all([
      establishSecureChannel(rig.guestEnd, rig.guestOptions({ crypto: broken(rig.guestCrypto) })),
      establishSecureChannel(
        rig.hostEnd,
        rig.hostOptions({ crypto: broken(rig.hostCrypto), secret: OTHER_SECRET }),
      ),
    ]);
    expect(guest.role).toBe('guest');
    expect(host.role).toBe('host');
    const control = makeRig();
    const results = await Promise.all([
      outcome(establishSecureChannel(control.guestEnd, control.guestOptions())),
      outcome(establishSecureChannel(control.hostEnd, control.hostOptions({ secret: OTHER_SECRET }))),
    ]);
    expect(results.every((result) => !result.ok)).toBe(true);
  });
});

describe('establishSecureChannel: interop with an independent implementation of the spec (node:crypto only)', () => {
  it('real host <-> reference guest', async () => {
    const rig = makeRig();
    const reference = startReferenceGuest(rig.guestEnd, SECRET, PAIR_ID);
    const host = await establishSecureChannel(rig.hostEnd, rig.hostOptions());
    const atHost = collect(host);
    reference.send({ type: 'ping', id: 1, t: 11 });
    await host.send({ type: 'pong', id: 1, t: 11 });
    await host.send({ type: 'bye', reason: 'user-ended' });
    reference.send({
      type: 'peer-state',
      name: 'Ref',
      muted: true,
      headsetConnected: false,
      batteryPct: null,
      charging: null,
      interruption: 'phone-call',
    });
    await settle();
    expect(reference.errors).toEqual([]);
    expect(reference.established).toBe(true);
    expect(reference.messages).toEqual([
      { type: 'pong', id: 1, t: 11 },
      { type: 'bye', reason: 'user-ended' },
    ]);
    expect(atHost.map((m) => m.type)).toEqual(['ping', 'peer-state']);
  });

  it('real guest <-> reference host', async () => {
    const rig = makeRig();
    const reference = startReferenceHost(rig.hostEnd, SECRET, PAIR_ID);
    const guest = await establishSecureChannel(rig.guestEnd, rig.guestOptions());
    const atGuest = collect(guest);
    reference.send({ type: 'sdp', generation: 4, kind: 'offer', sdp: 'v=0' });
    await guest.send({ type: 'sdp', generation: 4, kind: 'answer', sdp: 'v=0' });
    await guest.send({ type: 'ice', generation: 4, candidate: null });
    await settle();
    expect(reference.errors).toEqual([]);
    expect(reference.messages).toEqual([
      { type: 'sdp', generation: 4, kind: 'answer', sdp: 'v=0' },
      { type: 'ice', generation: 4, candidate: null },
    ]);
    expect(atGuest).toEqual([{ type: 'sdp', generation: 4, kind: 'offer', sdp: 'v=0' }]);
  });

  it('interop holds across 40 random seeds and random chunking', async () => {
    const next = mulberry32(4040);
    for (let seed = 1; seed <= 40; seed++) {
      const rig = makeRig({ seed, pipe: { chunker: randomChunker(next, 1 + randomInt(next, 0, 60)) } });
      const guestRef = startReferenceGuest(rig.guestEnd, SECRET, PAIR_ID);
      const host = await establishSecureChannel(rig.hostEnd, rig.hostOptions());
      const atHost = collect(host);
      for (let i = 0; i < 5; i++) {
        guestRef.send({ ...ping(i) });
        await host.send({ type: 'pong', id: i, t: i });
      }
      await settle();
      expect(guestRef.errors).toEqual([]);
      expect(atHost.length).toBe(5);
      expect(guestRef.messages.length).toBe(5);
    }
  });

  it('the reference guest also works against a host that was given a different (wrong) secret: both refuse', async () => {
    const rig = makeRig();
    const reference = startReferenceGuest(rig.guestEnd, SECRET, PAIR_ID);
    const result = await outcome(
      establishSecureChannel(rig.hostEnd, rig.hostOptions({ secret: OTHER_SECRET })),
    );
    await settle();
    expect(result.ok).toBe(false);
    expect(reference.established).toBe(false);
    expect(reference.errors).toEqual(['host proof invalid']);
  });
});

describe('establishSecureChannel: chunk boundaries and coalescing', () => {
  it('fuzz: 120 handshakes with random chunking in both directions, then 30 random messages each way', async () => {
    const next = mulberry32(777);
    for (let round = 0; round < 120; round++) {
      const maxPiece = round % 3 === 0 ? 1 : randomInt(next, 1, 90);
      const rig = makeRig({
        seed: 500 + round,
        pipe: { chunker: randomChunker(next, maxPiece), delivery: round % 4 === 0 ? 'sync' : 'async' },
      });
      const { guest, host } = await establishPair(rig);
      const atHost = collect(host);
      const atGuest = collect(guest);
      const sentToHost: SessionMessage[] = [];
      const sentToGuest: SessionMessage[] = [];
      for (let i = 0; i < 30; i++) {
        const sdp = 'x'.repeat(randomInt(next, 0, 600));
        const toHost: SessionMessage = { type: 'sdp', generation: i, kind: 'offer', sdp };
        const toGuest: SessionMessage = {
          type: 'ice',
          generation: i,
          candidate: { candidate: sdp, sdpMid: '0', sdpMLineIndex: i },
        };
        sentToHost.push(toHost);
        sentToGuest.push(toGuest);
        void guest.send(toHost);
        void host.send(toGuest);
      }
      await settle();
      expect(atHost).toEqual(sentToHost);
      expect(atGuest).toEqual(sentToGuest);
    }
  });

  it('byte-at-a-time delivery (the cruellest chunking) completes the handshake', async () => {
    const rig = makeRig({ pipe: { chunker: byteAtATime } });
    const { guest, host } = await establishPair(rig);
    const atGuest = collect(guest);
    await host.send(ping(1));
    await settle();
    expect(atGuest).toEqual([ping(1)]);
  });

  it('messages that share a chunk with `ready` are not lost (guest): delivered to the first listener', async () => {
    // Merge the host's first two frames (ready + first message) into ONE chunk, as TCP may.
    let heldReady: Uint8Array | null = null;
    const rig = makeRig({
      pipe: {
        tapBtoA: (data, index) => {
          if (index === 1) {
            heldReady = data; // frame 0 is hello-ack, frame 1 is `ready`
            return [];
          }
          if (index === 2 && heldReady !== null) return [concatBytes(heldReady, data)];
          return [data];
        },
      },
    });
    const guestPromise = establishSecureChannel(rig.guestEnd, rig.guestOptions());
    const host = await establishSecureChannel(rig.hostEnd, rig.hostOptions());
    await host.send({
      type: 'peer-state',
      name: 'Rider',
      muted: false,
      headsetConnected: true,
      batteryPct: 70,
      charging: false,
      interruption: 'none',
    });
    await host.send({ type: 'sdp', generation: 1, kind: 'offer', sdp: 'v=0' });
    const guest = await guestPromise;
    const received = collect(guest); // subscribes only after establish resolved
    await settle();
    expect(received.map((m) => m.type)).toEqual(['peer-state', 'sdp']);
  });

  it('host side: a reference guest that pipelines `auth` + its first message in one chunk loses nothing', async () => {
    const rig = makeRig();
    const hostPromise = establishSecureChannel(rig.hostEnd, rig.hostOptions());
    // Build the whole guest side by hand so `auth` and the first authenticated frame travel in ONE write.
    const nonceGuest = Buffer.from(pattern(16, 0x33));
    const pairIdBytes = Buffer.from(PAIR_ID, 'base64url');
    const frame = (payload: Buffer): Buffer => {
      const header = Buffer.alloc(4);
      header.writeUInt32BE(payload.length);
      return Buffer.concat([header, payload]);
    };
    const hmac = (key: Buffer, data: Buffer): Buffer => createHmac('sha256', key).update(data).digest();
    let nonceHost: Buffer | null = null;
    let collected = Buffer.alloc(0);
    const stop: Unsubscribe = rig.guestEnd.onData((chunk) => {
      collected = Buffer.concat([collected, chunk]);
      if (nonceHost !== null || collected.length < 4) return;
      const length = collected.readUInt32BE(0);
      if (collected.length < 4 + length) return;
      const ack = JSON.parse(collected.subarray(4, 4 + length).toString('utf8')) as { nonce: string };
      nonceHost = Buffer.from(ack.nonce, 'base64url');
      const authKey = Buffer.from(hkdfSync('sha256', SECRET, Buffer.alloc(0), 'pillion/v1/auth', 32));
      const proof = hmac(authKey, Buffer.concat([Buffer.from('guest'), pairIdBytes, nonceHost, nonceGuest]));
      const okm = Buffer.from(
        hkdfSync('sha256', SECRET, Buffer.concat([nonceGuest, nonceHost]), 'pillion/v1/session', 64),
      );
      const counter = Buffer.alloc(8);
      const body = Buffer.from('{"type":"ping","id":42,"t":7}');
      const tag = hmac(okm.subarray(0, 32), Buffer.concat([counter, body]));
      const auth = frame(Buffer.from(JSON.stringify({ type: 'auth', proof: proof.toString('base64url') })));
      void rig.guestEnd.send(new Uint8Array(Buffer.concat([auth, frame(Buffer.concat([tag, body]))])));
    });
    void rig.guestEnd.send(
      new Uint8Array(
        frame(
          Buffer.from(
            JSON.stringify({ type: 'hello', v: 1, pairId: PAIR_ID, nonce: nonceGuest.toString('base64url') }),
          ),
        ),
      ),
    );
    const host = await hostPromise;
    stop();
    const got = collect(host);
    await settle();
    expect(got).toEqual([{ type: 'ping', id: 42, t: 7 }]);
  });
});

describe('establishSecureChannel: option validation (programmer errors are TypeErrors and close the link)', () => {
  const secretLooksLike = (text: string): boolean =>
    text.includes(toHex(SECRET)) || text.includes(base64urlEncode(SECRET));

  it.each([
    ['null options', null],
    ['role missing', { role: undefined }],
    ['role unknown', { role: 'admin' }],
    ['pairId not a string', { pairId: 12 as unknown as string }],
    ['pairId too short', { pairId: PAIR_ID.slice(0, 20) }],
    ['pairId too long', { pairId: PAIR_ID + 'AA' }],
    ['pairId with padding', { pairId: PAIR_ID + '==' }],
    ['pairId non-canonical', { pairId: PAIR_ID.slice(0, 21) + 'B' }],
    ['pairId empty', { pairId: '' }],
    ['secret 31 bytes', { secret: new Uint8Array(31) }],
    ['secret 33 bytes', { secret: new Uint8Array(33) }],
    ['secret a string', { secret: 'x'.repeat(32) as unknown as Uint8Array }],
    ['secret an array', { secret: Array.from(SECRET) as unknown as Uint8Array }],
    ['crypto missing', { crypto: undefined as never }],
    ['crypto lacks hmac', { crypto: { randomBytes: () => new Uint8Array(16) } as never }],
    ['handshakeTimeoutMs zero', { handshakeTimeoutMs: 0 }],
    ['handshakeTimeoutMs negative', { handshakeTimeoutMs: -5 }],
    ['handshakeTimeoutMs NaN', { handshakeTimeoutMs: NaN }],
    ['handshakeTimeoutMs a string', { handshakeTimeoutMs: '5000' as unknown as number }],
    ['setTimeout without clearTimeout', { setTimeout: () => 1, clearTimeout: undefined }],
    ['clearTimeout without setTimeout', { setTimeout: undefined, clearTimeout: () => undefined }],
  ])('%s', async (_label, patch) => {
    const rig = makeRig();
    const options = patch === null ? (null as never) : ({ ...rig.guestOptions(), ...patch } as never);
    const result = await outcome(establishSecureChannel(rig.guestEnd, options));
    expect(result.ok).toBe(false);
    expect(codeOf(result)).toBe('TypeError');
    expect(rig.guestEnd.closeCalls).toBe(1);
    expect(rig.guestEnd.sent.length).toBe(0);
    if (!result.ok) expect(secretLooksLike(String((result.error as Error).message))).toBe(false);
  });

  it('never touches the crypto provider when the options are bad', async () => {
    const rig = makeRig();
    const spy = countingCrypto(rig.guestCrypto);
    await outcome(
      establishSecureChannel(
        rig.guestEnd,
        rig.guestOptions({ crypto: spy.crypto, secret: new Uint8Array(5) }),
      ),
    );
    expect(spy.total()).toBe(0);
  });
});

describe('establishSecureChannel: the caller`s secret', () => {
  it('is copied: neither modified nor retained, and the private copy is wiped on success', async () => {
    const rig = makeRig();
    const secret = new Uint8Array(SECRET);
    const guestSpy = countingCrypto(rig.guestCrypto);
    const hostSpy = countingCrypto(rig.hostCrypto);
    const [guest, host] = await Promise.all([
      establishSecureChannel(rig.guestEnd, rig.guestOptions({ crypto: guestSpy.crypto, secret })),
      establishSecureChannel(
        rig.hostEnd,
        rig.hostOptions({ crypto: hostSpy.crypto, secret: new Uint8Array(SECRET) }),
      ),
    ]);
    expect(bytesEqual(secret, SECRET)).toBe(true); // the caller's array is untouched
    const privateCopies = [...guestSpy.ikm, ...hostSpy.ikm].filter((ikm) => ikm.length === 32);
    expect(privateCopies.length).toBeGreaterThan(0);
    for (const copy of privateCopies) {
      expect(copy).not.toBe(secret);
      expect(copy.every((byte) => byte === 0)).toBe(true); // wiped once the keys were derived
    }
    secret.fill(0); // the caller may wipe its array right away: the channels do not depend on it
    const atHost = collect(host);
    await guest.send(ping(1));
    await settle();
    expect(atHost).toEqual([ping(1)]);
  });

  it('is wiped on failure too, and the caller`s array stays intact', async () => {
    const rig = makeRig();
    const secret = new Uint8Array(SECRET);
    const hostSpy = countingCrypto(rig.hostCrypto);
    const result = await outcome(
      Promise.all([
        establishSecureChannel(rig.guestEnd, rig.guestOptions({ secret: new Uint8Array(OTHER_SECRET) })),
        establishSecureChannel(rig.hostEnd, rig.hostOptions({ crypto: hostSpy.crypto, secret })),
      ]).then(([guest]) => guest),
    );
    expect(result.ok).toBe(false);
    expect(bytesEqual(secret, SECRET)).toBe(true);
    for (const copy of hostSpy.ikm) expect(copy.every((byte) => byte === 0)).toBe(true);
  });
});

describe('establishSecureChannel: handshake timeout (injected timers)', () => {
  it('host: a silent peer ends the handshake exactly at the deadline, closing the link', async () => {
    const timers = new ManualTimers();
    const rig = makeRig({ timers });
    const pending = outcome(establishSecureChannel(rig.hostEnd, rig.hostOptions()));
    await settle();
    expect(timers.pending).toBe(1);
    timers.advance(DEFAULT_HANDSHAKE_TIMEOUT_MS - 1);
    await settle();
    expect(rig.hostEnd.closeCalls).toBe(0);
    timers.advance(1);
    const result = await pending;
    expect(codeOf(result)).toBe('handshake-timeout');
    expect(rig.hostEnd.closeCalls).toBe(1);
    expect(timers.pending).toBe(0);
  });

  it('guest: a peer that never answers hello times out', async () => {
    const timers = new ManualTimers();
    const rig = makeRig({ timers });
    const pending = outcome(establishSecureChannel(rig.guestEnd, rig.guestOptions()));
    await settle();
    expect(rig.guestEnd.sent.length).toBe(1); // hello went out
    timers.advance(DEFAULT_HANDSHAKE_TIMEOUT_MS);
    expect(codeOf(await pending)).toBe('handshake-timeout');
    expect(rig.guestEnd.closeCalls).toBe(1);
  });

  it('honours handshakeTimeoutMs, and the default is 5000 ms', async () => {
    const seen: number[] = [];
    const fake = new ManualTimers();
    const record = (fn: () => void, ms: number): unknown => {
      seen.push(ms);
      return fake.setTimeout(fn, ms);
    };
    const a = makeRig({});
    const first = outcome(
      establishSecureChannel(
        a.hostEnd,
        a.hostOptions({ setTimeout: record, clearTimeout: fake.clearTimeout, handshakeTimeoutMs: 1234 }),
      ),
    );
    const b = makeRig({});
    const second = outcome(
      establishSecureChannel(
        b.hostEnd,
        b.hostOptions({ setTimeout: record, clearTimeout: fake.clearTimeout }),
      ),
    );
    await settle();
    expect(seen).toEqual([1234, 5000]);
    fake.advance(10_000);
    expect(codeOf(await first)).toBe('handshake-timeout');
    expect(codeOf(await second)).toBe('handshake-timeout');
  });

  it('without injected timers the global setTimeout/clearTimeout are used (real 20 ms deadline)', async () => {
    const { a } = createMemoryPipe();
    const crypto = createCryptoProvider(seededRandomBytes(3));
    const started = Date.now();
    const result = await outcome(
      establishSecureChannel(a, {
        role: 'host',
        pairId: PAIR_ID,
        secret: SECRET,
        crypto,
        handshakeTimeoutMs: 20,
      }),
    );
    expect(codeOf(result)).toBe('handshake-timeout');
    expect(Date.now() - started).toBeGreaterThanOrEqual(15);
    expect(Date.now() - started).toBeLessThan(2000);
  });

  it('with real timers a successful handshake leaves nothing armed (the process can exit)', async () => {
    const { a, b } = createMemoryPipe();
    const [guest, host] = await Promise.all([
      establishSecureChannel(a, {
        role: 'guest',
        pairId: PAIR_ID,
        secret: SECRET,
        crypto: createCryptoProvider(seededRandomBytes(1)),
        handshakeTimeoutMs: 60_000,
      }),
      establishSecureChannel(b, {
        role: 'host',
        pairId: PAIR_ID,
        secret: SECRET,
        crypto: createCryptoProvider(seededRandomBytes(2)),
        handshakeTimeoutMs: 60_000,
      }),
    ]);
    // A 60 s real timer still armed would make Jest report an open handle after the run.
    await Promise.all([guest.close(), host.close()]);
  });

  it('the timer is cleared when the handshake succeeds, so no deadline lingers', async () => {
    const timers = new ManualTimers();
    const rig = makeRig({ timers });
    await establishPair(rig);
    expect(timers.pending).toBe(0);
    expect(timers.cleared.length).toBe(2);
    timers.advance(60_000); // nothing may fire later and kill a healthy channel
    await settle();
    expect(rig.guestEnd.isClosed).toBe(false);
    expect(rig.hostEnd.isClosed).toBe(false);
  });

  it('the timer is cleared when the handshake fails', async () => {
    const timers = new ManualTimers();
    const rig = makeRig({ timers });
    const results = await Promise.all([
      outcome(establishSecureChannel(rig.guestEnd, rig.guestOptions({ secret: OTHER_SECRET }))),
      outcome(establishSecureChannel(rig.hostEnd, rig.hostOptions())),
    ]);
    expect(results.every((r) => !r.ok)).toBe(true);
    expect(timers.pending).toBe(0);
  });

  it('the deadline runs from the call, not from the first byte: a peer trickling one byte per second cannot extend it', async () => {
    const timers = new ManualTimers();
    const rig = makeRig({ timers });
    const pending = outcome(establishSecureChannel(rig.hostEnd, rig.hostOptions()));
    const hello = encodeFrame(
      new TextEncoder().encode(
        `{"type":"hello","v":1,"pairId":"${PAIR_ID}","nonce":"${base64urlEncode(pattern(16))}"}`,
      ),
    );
    let delivered = 0;
    for (; delivered < hello.length - 1; delivered++) {
      rig.hostEnd.inject(hello.subarray(delivered, delivered + 1));
      await settle(1);
      timers.advance(1000);
      if (timers.pending === 0) break;
    }
    const result = await pending;
    expect(codeOf(result)).toBe('handshake-timeout');
    expect(delivered).toBeLessThanOrEqual(5);
    expect(rig.hostEnd.closeCalls).toBe(1);
  });

  it('a timeout that fires after the auth step but before `ready` finished sending still ends the handshake', async () => {
    // The host's link accepts writes but never completes them: it hangs while sending `ready`.
    const timers = new ManualTimers();
    const rig = makeRig({ timers });
    const guestPromise = outcome(establishSecureChannel(rig.guestEnd, rig.guestOptions()));
    const realSend = rig.hostEnd.send.bind(rig.hostEnd);
    let writes = 0;
    rig.hostEnd.send = (data: Uint8Array): Promise<void> => {
      writes += 1;
      if (writes === 2) return new Promise<void>(() => undefined); // `ready` never completes
      return realSend(data);
    };
    const hostPromise = outcome(establishSecureChannel(rig.hostEnd, rig.hostOptions()));
    await settle();
    expect(writes).toBe(2);
    timers.advance(DEFAULT_HANDSHAKE_TIMEOUT_MS);
    expect(codeOf(await hostPromise)).toBe('handshake-timeout');
    expect(rig.hostEnd.closeCalls).toBe(1);
    await guestPromise;
  });

  it('a stuck reject hint does not stop the original error from being reported at the deadline', async () => {
    const timers = new ManualTimers();
    const rig = makeRig({ timers });
    rig.hostEnd.send = (): Promise<void> => new Promise<void>(() => undefined); // every write hangs
    const pending = outcome(establishSecureChannel(rig.hostEnd, rig.hostOptions()));
    await settle();
    rig.hostEnd.inject(encodeFrame(new TextEncoder().encode('{"type":"nonsense"}'))); // provokes reject{malformed}
    await settle();
    expect(timers.pending).toBe(1); // still waiting for the hint to be written
    timers.advance(DEFAULT_HANDSHAKE_TIMEOUT_MS);
    const result = await pending;
    expect(codeOf(result)).toBe('malformed-frame'); // the real reason, not 'handshake-timeout'
    expect(rig.hostEnd.closeCalls).toBe(1);
  });
});

describe('establishSecureChannel: the link failing mid-handshake', () => {
  it('the peer closing the link ends the handshake with `closed` (both roles) without closing a dead link again', async () => {
    for (const role of ['guest', 'host'] as const) {
      const rig = makeRig();
      const end = role === 'guest' ? rig.guestEnd : rig.hostEnd;
      const other = role === 'guest' ? rig.hostEnd : rig.guestEnd;
      const pending = outcome(
        establishSecureChannel(end, role === 'guest' ? rig.guestOptions() : rig.hostOptions()),
      );
      await settle();
      await other.close();
      const result = await pending;
      expect(codeOf(result)).toBe('closed');
      expect(end.closeCalls).toBe(0); // the link was already closed by the peer
    }
  });

  it('a link drop during the handshake is `closed` and mentions the transport reason, not any secret', async () => {
    const rig = makeRig();
    const pending = outcome(establishSecureChannel(rig.guestEnd, rig.guestOptions()));
    await settle();
    rig.guestEnd.dropLink('network-lost');
    const result = await pending;
    expect(codeOf(result)).toBe('closed');
    expect(result.ok ? '' : (result.error as Error).message).toContain('network-lost');
  });

  it('a write failure while sending hello is `closed`, and the link is closed', async () => {
    const rig = makeRig();
    rig.guestEnd.failSends = true;
    const result = await outcome(establishSecureChannel(rig.guestEnd, rig.guestOptions()));
    expect(codeOf(result)).toBe('closed');
    expect(rig.guestEnd.closeCalls).toBe(1);
  });

  it('a link whose send() throws synchronously is treated like a write failure', async () => {
    const rig = makeRig();
    rig.guestEnd.send = (): Promise<void> => {
      throw new Error('native bridge exploded');
    };
    const result = await outcome(establishSecureChannel(rig.guestEnd, rig.guestOptions()));
    expect(codeOf(result)).toBe('closed');
    expect(rig.guestEnd.closeCalls).toBe(1);
  });

  it('a link whose close() rejects or throws cannot make the failure path blow up or hang', async () => {
    const rig = makeRig();
    rig.hostEnd.close = (): Promise<void> => Promise.reject(new Error('close failed'));
    const hostResult = outcome(
      establishSecureChannel(rig.hostEnd, rig.hostOptions({ secret: OTHER_SECRET })),
    );
    const guestResult = outcome(establishSecureChannel(rig.guestEnd, rig.guestOptions()));
    const [host, guest] = await Promise.all([hostResult, guestResult]);
    expect(host.ok).toBe(false);
    expect(guest.ok).toBe(false);
    const throwing = makeRig();
    throwing.hostEnd.close = (): Promise<void> => {
      throw new Error('close threw');
    };
    const results = await Promise.all([
      outcome(establishSecureChannel(throwing.hostEnd, throwing.hostOptions({ secret: OTHER_SECRET }))),
      outcome(establishSecureChannel(throwing.guestEnd, throwing.guestOptions())),
    ]);
    expect(results.every((r) => !r.ok)).toBe(true);
  });

  it('a link that fails while subscribing does not hang: the error is reported and the link closed', async () => {
    const rig = makeRig();
    rig.hostEnd.onData = (): Unsubscribe => {
      throw new Error('cannot subscribe');
    };
    const result = await outcome(establishSecureChannel(rig.hostEnd, rig.hostOptions()));
    expect(result.ok).toBe(false);
    expect(rig.hostEnd.closeCalls).toBe(1);
  });

  it('a link that delivers non-byte chunks is refused as malformed', async () => {
    const rig = makeRig();
    const pending = outcome(establishSecureChannel(rig.hostEnd, rig.hostOptions()));
    await settle();
    // Reach the listener directly the way a buggy native bridge would.
    const listeners = (rig.hostEnd as unknown as { dataListeners: Set<(d: unknown) => void> }).dataListeners;
    for (const listener of Array.from(listeners)) listener('definitely not bytes');
    expect(codeOf(await pending)).toBe('malformed-frame');
  });
});

describe('establishSecureChannel: an established channel and its link', () => {
  it('closing either secure channel closes the link once and tells the other side', async () => {
    const rig = makeRig();
    const { guest, host } = await establishPair(rig);
    const hostCloses: string[] = [];
    host.onClose((reason) => hostCloses.push(reason));
    await guest.close();
    await settle();
    expect(rig.guestEnd.closeCalls).toBe(1);
    expect(hostCloses).toEqual(['remote-close']);
  });

  it('a link drop after establishment surfaces as the transport reason', async () => {
    const rig = makeRig();
    const { guest, host } = await establishPair(rig);
    const reasons: string[] = [];
    guest.onClose((reason) => reasons.push(`guest:${reason}`));
    host.onClose((reason) => reasons.push(`host:${reason}`));
    rig.guestEnd.dropLink('network-lost');
    await settle();
    expect(reasons.sort()).toEqual(['guest:network-lost', 'host:network-lost']);
    const error = await guest.send(ping(1)).catch((e: unknown) => e);
    expect((error as ProtocolError).code).toBe('closed');
  });

  it('the channel is usable for a whole ride-length stream: 2000 messages each way stay in order', async () => {
    const rig = makeRig();
    const { guest, host } = await establishPair(rig);
    const atHost = collect(host);
    const atGuest = collect(guest);
    for (let i = 0; i < 2000; i++) {
      void guest.send(ping(i));
      void host.send({ type: 'pong', id: i, t: i });
    }
    await settle(10);
    expect(atHost.length).toBe(2000);
    expect(atGuest.length).toBe(2000);
    expect(atHost.every((m, i) => m.type === 'ping' && m.id === i)).toBe(true);
    expect(atGuest.every((m, i) => m.type === 'pong' && m.id === i)).toBe(true);
  });

  it('a message larger than one frame is refused without disturbing the channel', async () => {
    const rig = makeRig();
    const { guest, host } = await establishPair(rig);
    const atHost = collect(host);
    const error = await guest
      .send({ type: 'sdp', generation: 1, kind: 'offer', sdp: 'x'.repeat(MAX_FRAME_BYTES) })
      .catch((e: unknown) => e);
    expect((error as ProtocolError).code).toBe('frame-too-large');
    await guest.send(ping(1));
    await settle();
    expect(atHost).toEqual([ping(1)]);
  });
});

describe('ByteChannel contract assumptions the implementation relies on', () => {
  it('works with a minimal ByteChannel that has exactly the four methods and nothing else', async () => {
    const pipe = createMemoryPipe();
    const narrow = (end: ByteChannel): ByteChannel => ({
      send: (data) => end.send(data),
      onData: (listener) => end.onData(listener),
      onClose: (listener) => end.onClose(listener),
      close: () => end.close(),
    });
    const crypto = createCryptoProvider(seededRandomBytes(9));
    const [guest, host] = await Promise.all([
      establishSecureChannel(narrow(pipe.a), { role: 'guest', pairId: PAIR_ID, secret: SECRET, crypto }),
      establishSecureChannel(narrow(pipe.b), {
        role: 'host',
        pairId: PAIR_ID,
        secret: SECRET,
        crypto: createCryptoProvider(seededRandomBytes(10)),
      }),
    ]);
    const atHost = collect(host);
    await guest.send(ping(1));
    await settle();
    expect(atHost).toEqual([ping(1)]);
  });
});
