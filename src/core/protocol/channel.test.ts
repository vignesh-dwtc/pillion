/// <reference types="node" />
import { afterEach, describe, expect, it } from '@jest/globals';
import { createHmac } from 'node:crypto';

import type { Unsubscribe } from '../common/types';
import { createSecureChannel, type SecureChannelImpl } from './channel';
import { encodeSessionMessage } from './codec';
import { concatBytes, u64ToBytes } from './bytes';
import { MAC_BYTES, MAX_FRAME_BYTES } from './constants';
import { FrameDecoder, encodeFrame } from './frame';
import { deriveSessionKeys, sealFrame, type SessionKeys } from './handshake';
import { MAX_BACKLOG_MESSAGES } from './limits';
import type { SessionMessage } from './messages';
import { createCryptoProvider } from './noble';
import { ProtocolError, type ByteChannel } from './secureChannel';
import { bytesEqual, pattern, toHex } from './testing/hex';
import { createMemoryPipe, settle, type PipeOptions, type MemoryEnd } from './testing/memoryPipe';
import { seededRandomBytes } from './testing/rng';
import { utf8Encode } from './utf8';

afterEach(async () => {
  await settle(); // any unhandled promise rejection surfaces here and fails the test that caused it
});

const crypto = createCryptoProvider(seededRandomBytes(1));
const SECRET = pattern(32);
const NONCE_GUEST = pattern(16, 0x80);
const NONCE_HOST = pattern(16, 0xc0);

function freshKeys(): SessionKeys {
  return deriveSessionKeys(crypto, SECRET, NONCE_GUEST, NONCE_HOST);
}

interface Pair {
  guest: SecureChannelImpl;
  host: SecureChannelImpl;
  guestEnd: MemoryEnd;
  hostEnd: MemoryEnd;
  keys: SessionKeys;
  /** Keys as the guest/host hold them (wiped on close), for assertions about wiping. */
  guestHeld: { send: Uint8Array; recv: Uint8Array };
  hostHeld: { send: Uint8Array; recv: Uint8Array };
}

function makePair(options: PipeOptions = {}): Pair {
  const pipe = createMemoryPipe(options);
  const keys = freshKeys();
  const guestHeld = { send: new Uint8Array(keys.guestToHost), recv: new Uint8Array(keys.hostToGuest) };
  const hostHeld = { send: new Uint8Array(keys.hostToGuest), recv: new Uint8Array(keys.guestToHost) };
  const guest = createSecureChannel({
    role: 'guest',
    channel: pipe.a,
    decoder: new FrameDecoder(),
    crypto,
    sendKey: guestHeld.send,
    recvKey: guestHeld.recv,
    sendCounter: 0,
    recvCounter: 0,
  });
  const host = createSecureChannel({
    role: 'host',
    channel: pipe.b,
    decoder: new FrameDecoder(),
    crypto,
    sendKey: hostHeld.send,
    recvKey: hostHeld.recv,
    sendCounter: 0,
    recvCounter: 0,
  });
  return { guest, host, guestEnd: pipe.a, hostEnd: pipe.b, keys, guestHeld, hostHeld };
}

function collect(channel: { onMessage(l: (m: SessionMessage) => void): Unsubscribe }): SessionMessage[] {
  const messages: SessionMessage[] = [];
  channel.onMessage((message) => messages.push(message));
  return messages;
}

function reasons(channel: { onClose(l: (r: string) => void): Unsubscribe }): string[] {
  const seen: string[] = [];
  channel.onClose((reason) => seen.push(reason));
  return seen;
}

const ping = (id: number): SessionMessage => ({ type: 'ping', id, t: id * 10 });

/** The exact bytes a correct sender puts on the wire for `message` as its frame number `counter`. */
function wireFrame(key: Uint8Array, counter: number, message: SessionMessage): Uint8Array {
  return encodeFrame(sealFrame(crypto, key, counter, encodeSessionMessage(message)));
}

async function rejection(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
  } catch (error) {
    return error;
  }
  throw new Error('expected the promise to reject');
}

describe('SecureChannelImpl: normal operation', () => {
  it('delivers messages in both directions, in order, with the right role', async () => {
    const { guest, host } = makePair();
    const atHost = collect(host);
    const atGuest = collect(guest);
    for (let i = 0; i < 50; i++) {
      await guest.send(ping(i));
      await host.send({ type: 'pong', id: i, t: i });
    }
    await settle();
    expect(atHost).toEqual(Array.from({ length: 50 }, (_, i) => ping(i)));
    expect(atGuest).toEqual(Array.from({ length: 50 }, (_, i) => ({ type: 'pong', id: i, t: i })));
    expect(guest.role).toBe('guest');
    expect(host.role).toBe('host');
  });

  it('puts exactly [u32 length][HMAC tag][JSON] on the wire, tag over u64be(counter) || json, per direction', async () => {
    const { guest, host, guestEnd, hostEnd, keys } = makePair();
    const messages = [ping(1), ping(2), { type: 'bye', reason: 'user-ended' } as const];
    for (const message of messages) await guest.send(message);
    await host.send({ type: 'ready' });
    await settle();
    expect(guestEnd.sent.length).toBe(3);
    messages.forEach((message, counter) => {
      const wire = guestEnd.sent[counter] ?? new Uint8Array();
      const body = utf8Encode(JSON.stringify(message));
      const tag = createHmac('sha256', keys.guestToHost)
        .update(concatBytes(u64ToBytes(counter), body))
        .digest();
      const expected = concatBytes(
        new Uint8Array([0, 0, 0, MAC_BYTES + body.length]),
        new Uint8Array(tag),
        body,
      );
      expect(toHex(wire)).toBe(toHex(expected));
    });
    // The host's first frame uses ITS direction key and ITS counter 0.
    const hostBody = utf8Encode('{"type":"ready"}');
    const hostTag = createHmac('sha256', keys.hostToGuest)
      .update(concatBytes(u64ToBytes(0), hostBody))
      .digest();
    expect(toHex((hostEnd.sent[0] ?? new Uint8Array()).subarray(4, 4 + MAC_BYTES))).toBe(
      toHex(new Uint8Array(hostTag)),
    );
  });

  it('nonce reuse: the same message sent twice gives two different frames (the counter is in the MAC)', async () => {
    const { guest, guestEnd } = makePair();
    await guest.send(ping(7));
    await guest.send(ping(7));
    const [first, second] = guestEnd.sent;
    expect(toHex(first ?? new Uint8Array())).not.toBe(toHex(second ?? new Uint8Array()));
    expect(toHex((first ?? new Uint8Array()).subarray(4, 4 + MAC_BYTES))).not.toBe(
      toHex((second ?? new Uint8Array()).subarray(4, 4 + MAC_BYTES)),
    );
    // Same body bytes, so only the MAC differs.
    expect(toHex((first ?? new Uint8Array()).subarray(4 + MAC_BYTES))).toBe(
      toHex((second ?? new Uint8Array()).subarray(4 + MAC_BYTES)),
    );
  });

  it('works across arbitrary chunk boundaries, including one byte at a time', async () => {
    const { guest, host } = makePair({ chunker: (data) => Array.from(data, (b) => Uint8Array.of(b)) });
    const atHost = collect(host);
    await guest.send({ type: 'sdp', generation: 2, kind: 'offer', sdp: 'v=0\r\n'.repeat(40) });
    await settle();
    expect(atHost.length).toBe(1);
    expect(atHost[0]?.type).toBe('sdp');
  });

  it('works when the link delivers synchronously inside send()', async () => {
    const { guest, host } = makePair({ delivery: 'sync' });
    const atHost = collect(host);
    await guest.send(ping(1));
    expect(atHost).toEqual([ping(1)]);
  });

  it('delivers a second `ready` as an ordinary message (it is authenticated; the session may ignore it)', async () => {
    const { guest, host } = makePair();
    const atGuest = collect(guest);
    await host.send({ type: 'ready' });
    await settle();
    expect(atGuest).toEqual([{ type: 'ready' }]);
  });

  it('the largest message that fits one frame goes through; one byte more is refused without closing', async () => {
    const { guest, host } = makePair();
    const atHost = collect(host);
    const overhead = encodeSessionMessage({ type: 'sdp', generation: 1, kind: 'offer', sdp: '' }).length;
    const fits = MAX_FRAME_BYTES - MAC_BYTES - overhead;
    await guest.send({ type: 'sdp', generation: 1, kind: 'offer', sdp: 'x'.repeat(fits) });
    await settle();
    expect(atHost.length).toBe(1);
    const error = await rejection(
      guest.send({ type: 'sdp', generation: 1, kind: 'offer', sdp: 'x'.repeat(fits + 1) }),
    );
    expect((error as ProtocolError).code).toBe('frame-too-large');
    // The channel is still sound and the refused message consumed no counter.
    await guest.send(ping(9));
    await settle();
    expect(atHost.length).toBe(2);
    expect(atHost[1]).toEqual(ping(9));
  });
});

describe('SecureChannelImpl: tampering and replay close the channel (fail closed)', () => {
  /** Establish a pair whose guest->host direction passes through `tap`; returns what the host observed. */
  async function attacked(tap: (data: Uint8Array, index: number) => Uint8Array[], sends: SessionMessage[]) {
    const pair = makePair({ tapAtoB: tap });
    const atHost = collect(pair.host);
    const closes = reasons(pair.host);
    for (const message of sends) {
      try {
        await pair.guest.send(message);
      } catch {
        // Once the host rejects an attack frame it hangs up, so later sends legitimately fail with `closed`.
      }
    }
    await settle();
    return { ...pair, atHost, closes };
  }

  it('control: an untouched tap delivers everything', async () => {
    const run = await attacked((data) => [data], [ping(1), ping(2), ping(3)]);
    expect(run.atHost).toEqual([ping(1), ping(2), ping(3)]);
    expect(run.closes).toEqual([]);
  });

  it('replay: a duplicated frame is rejected the second time', async () => {
    const run = await attacked((data, index) => (index === 0 ? [data, data] : [data]), [ping(1), ping(2)]);
    expect(run.atHost).toEqual([ping(1)]); // the original got through, the copy killed the channel
    expect(run.closes).toEqual(['bad-mac']);
    expect(run.hostEnd.closeCalls).toBe(1);
    expect(run.hostEnd.isClosed).toBe(true);
  });

  it('replay: a frame captured earlier and injected later is rejected', async () => {
    const pair = makePair();
    const atHost = collect(pair.host);
    const closes = reasons(pair.host);
    await pair.guest.send(ping(1));
    await pair.guest.send(ping(2));
    await settle();
    expect(atHost.length).toBe(2);
    pair.hostEnd.inject(pair.guestEnd.sent[0] ?? new Uint8Array()); // replay frame #0 at counter 2
    await settle();
    expect(atHost.length).toBe(2);
    expect(closes).toEqual(['bad-mac']);
  });

  it('reorder: two frames swapped in transit', async () => {
    let held: Uint8Array | null = null;
    const run = await attacked(
      (data, index) => {
        if (index === 0) {
          held = data;
          return [];
        }
        return index === 1 && held !== null ? [data, held] : [data];
      },
      [ping(1), ping(2)],
    );
    expect(run.atHost).toEqual([]); // frame #1 arrived first and was refused outright
    expect(run.closes).toEqual(['bad-mac']);
  });

  it('drop: a missing frame makes the next one fail', async () => {
    const run = await attacked((data, index) => (index === 1 ? [] : [data]), [ping(1), ping(2), ping(3)]);
    expect(run.atHost).toEqual([ping(1)]);
    expect(run.closes).toEqual(['bad-mac']);
  });

  it('cross-direction reflection: a frame the host sent, bounced back to the host, is refused', async () => {
    const pair = makePair();
    const atHost = collect(pair.host);
    const closes = reasons(pair.host);
    await pair.host.send(ping(1));
    await settle();
    pair.hostEnd.inject(pair.hostEnd.sent[0] ?? new Uint8Array()); // reflect its own frame at counter 0
    await settle();
    expect(atHost).toEqual([]);
    expect(closes).toEqual(['bad-mac']);
  });

  it('cross-direction reflection: a frame the guest sent, bounced back to the guest, is refused', async () => {
    const pair = makePair();
    const atGuest = collect(pair.guest);
    const closes = reasons(pair.guest);
    await pair.guest.send(ping(1));
    await settle();
    pair.guestEnd.inject(pair.guestEnd.sent[0] ?? new Uint8Array());
    await settle();
    expect(atGuest).toEqual([]);
    expect(closes).toEqual(['bad-mac']);
  });

  it('every single-bit flip in the tag or the body is detected (exhaustive over one frame)', async () => {
    const probe = makePair();
    await probe.guest.send({
      type: 'peer-state',
      name: 'Riya',
      muted: false,
      headsetConnected: true,
      batteryPct: 80,
      charging: false,
      interruption: 'none',
    });
    const original = (probe.guestEnd.sent[0] ?? new Uint8Array()).slice();
    expect(original.length).toBeGreaterThan(MAC_BYTES + 20);
    let checked = 0;
    for (let byte = 4; byte < original.length; byte++) {
      for (let bit = 0; bit < 8; bit++) {
        const pair = makePair();
        const got = collect(pair.host);
        const closes = reasons(pair.host);
        const flipped = new Uint8Array(original);
        flipped[byte] = (flipped[byte] ?? 0) ^ (1 << bit);
        pair.hostEnd.inject(flipped);
        await settle(1);
        expect(got.length).toBe(0);
        expect(closes).toEqual(['bad-mac']);
        checked += 1;
      }
    }
    expect(checked).toBe((original.length - 4) * 8);
  });

  it('flipping bits of the length header never lets an altered message through', async () => {
    const original = wireFrame(freshKeys().guestToHost, 0, ping(5));
    for (let byte = 0; byte < 4; byte++) {
      for (let bit = 0; bit < 8; bit++) {
        const pair = makePair();
        const got = collect(pair.host);
        const flipped = new Uint8Array(original);
        flipped[byte] = (flipped[byte] ?? 0) ^ (1 << bit);
        pair.hostEnd.inject(flipped);
        await settle(1);
        // A wrong length either closes the channel or leaves it waiting for bytes that never come.
        for (const message of got) expect(message).toEqual(ping(5));
        expect(got.length).toBeLessThanOrEqual(0);
      }
    }
  });

  it('truncation: a frame cut short is never delivered', async () => {
    const original = wireFrame(freshKeys().guestToHost, 0, ping(5));
    for (let keep = 0; keep < original.length; keep++) {
      const pair = makePair();
      const got = collect(pair.host);
      pair.hostEnd.inject(original.subarray(0, keep));
      await settle(1);
      expect(got.length).toBe(0);
    }
  });

  it('a frame too short to hold a tag is malformed-frame', async () => {
    const pair = makePair();
    const closes = reasons(pair.host);
    pair.hostEnd.inject(encodeFrame(new Uint8Array(MAC_BYTES)));
    await settle();
    expect(closes).toEqual(['malformed-frame']);
    expect(pair.hostEnd.closeCalls).toBe(1);
  });

  it('a zero-length frame is malformed-frame', async () => {
    const pair = makePair();
    const closes = reasons(pair.host);
    pair.hostEnd.inject(new Uint8Array(4));
    await settle();
    expect(closes).toEqual(['malformed-frame']);
  });

  it('an oversized length header is frame-too-large and does not wait for the payload', async () => {
    const pair = makePair();
    const closes = reasons(pair.host);
    pair.hostEnd.inject(Uint8Array.of(0x7f, 0xff, 0xff, 0xff));
    await settle();
    expect(closes).toEqual(['frame-too-large']);
    expect(pair.hostEnd.isClosed).toBe(true);
  });

  it('a frame with a VALID tag but a body that is not a valid message still closes the channel', async () => {
    const keys = freshKeys();
    for (const body of [
      utf8Encode('not json'),
      utf8Encode('{"type":"launch-missiles"}'),
      utf8Encode('[1,2,3]'),
      utf8Encode('{"type":"sdp","generation":-1,"kind":"offer","sdp":"v=0"}'),
      Uint8Array.of(0xff, 0xfe, 0xfd, 0xfc),
    ]) {
      const pair = makePair();
      const got = collect(pair.host);
      const closes = reasons(pair.host);
      pair.hostEnd.inject(encodeFrame(sealFrame(crypto, keys.guestToHost, 0, body)));
      await settle();
      expect(got).toEqual([]);
      expect(closes).toEqual(['malformed-frame']);
      expect(pair.hostEnd.closeCalls).toBe(1);
    }
  });

  it('a correctly authenticated frame from a third party is only possible with the key: forged tags fail', async () => {
    const pair = makePair();
    const got = collect(pair.host);
    const closes = reasons(pair.host);
    const forgedKey = pattern(32, 9);
    pair.hostEnd.inject(wireFrame(forgedKey, 0, ping(1)));
    await settle();
    expect(got).toEqual([]);
    expect(closes).toEqual(['bad-mac']);
  });

  it('after a MAC failure nothing more is delivered, even valid frames that follow', async () => {
    const pair = makePair();
    const got = collect(pair.host);
    const closes = reasons(pair.host);
    const keys = freshKeys();
    pair.hostEnd.inject(
      concatBytes(
        wireFrame(keys.guestToHost, 0, ping(1)),
        wireFrame(pattern(32, 3), 1, ping(2)), // bad tag
        wireFrame(keys.guestToHost, 1, ping(3)), // would be valid if the channel had survived
      ),
    );
    await settle();
    expect(got).toEqual([ping(1)]);
    expect(closes).toEqual(['bad-mac']);
  });

  it('close-on-MAC-failure: the link is closed once, the sender is told, send() rejects with `closed`', async () => {
    const pair = makePair();
    const hostCloses = reasons(pair.host);
    const guestCloses = reasons(pair.guest);
    pair.hostEnd.inject(wireFrame(pattern(32, 3), 0, ping(1)));
    await settle();
    expect(hostCloses).toEqual(['bad-mac']);
    expect(pair.hostEnd.closeCalls).toBe(1);
    expect(guestCloses).toEqual(['remote-close']); // the peer learns through the link, nothing more
    const error = await rejection(pair.host.send(ping(2)));
    expect((error as ProtocolError).code).toBe('closed');
    expect(pair.host.closeError?.code).toBe('bad-mac');
  });
});

describe('SecureChannelImpl: listeners, backlog and close semantics', () => {
  it('queues messages that arrive before the first onMessage and delivers them, in order, on subscription', async () => {
    const { guest, host } = makePair();
    for (let i = 0; i < 5; i++) await guest.send(ping(i));
    await settle();
    const late = collect(host);
    expect(late).toEqual([ping(0), ping(1), ping(2), ping(3), ping(4)]);
    await guest.send(ping(5));
    await settle();
    expect(late.length).toBe(6);
  });

  it('the backlog goes to the first subscriber only; later subscribers see only new messages', async () => {
    const { guest, host } = makePair();
    await guest.send(ping(1));
    await settle();
    const first = collect(host);
    const second = collect(host);
    expect(first).toEqual([ping(1)]);
    expect(second).toEqual([]);
    await guest.send(ping(2));
    await settle();
    expect(first.length).toBe(2);
    expect(second).toEqual([ping(2)]);
  });

  it('after the first subscription, messages with no listener are dropped, not queued', async () => {
    const { guest, host } = makePair();
    const stop = host.onMessage(() => undefined);
    stop();
    await guest.send(ping(1));
    await settle();
    const late = collect(host);
    expect(late).toEqual([]);
  });

  it('keeps exactly MAX_BACKLOG_MESSAGES queued messages without closing', async () => {
    const { guest, host } = makePair();
    for (let i = 0; i < MAX_BACKLOG_MESSAGES; i++) await guest.send(ping(i));
    await settle();
    expect(host.closeError).toBeNull();
    const late = collect(host);
    expect(late.length).toBe(MAX_BACKLOG_MESSAGES);
    expect(late[0]).toEqual(ping(0));
    expect(late[late.length - 1]).toEqual(ping(MAX_BACKLOG_MESSAGES - 1));
  });

  it('fails closed when the backlog overflows: no message is silently dropped', async () => {
    const { guest, host } = makePair();
    const hostClosed: string[] = [];
    host.onClose((reason) => hostClosed.push(reason));
    for (let i = 0; i < MAX_BACKLOG_MESSAGES; i++) await guest.send(ping(i));
    await settle();
    expect(host.closeError).toBeNull();
    // One more authenticated message than the backlog holds.
    await guest.send(ping(MAX_BACKLOG_MESSAGES)).catch(() => undefined);
    await settle();
    expect(host.closeError).toBeInstanceOf(ProtocolError);
    expect(host.closeError?.code).toBe('closed');
    expect(hostClosed).toEqual(['closed']);
    // The transport is closed too, so the peer learns about it instead of waiting.
    expect(guest.closeError).not.toBeNull();
    // The queue is discarded, never handed to a late subscriber.
    expect(collect(host)).toEqual([]);
  });

  it('a throwing listener does not stop delivery to others or break the channel', async () => {
    const { guest, host } = makePair();
    const good = collect(host);
    host.onMessage(() => {
      throw new Error('listener bug');
    });
    const alsoGood = collect(host);
    await guest.send(ping(1));
    await guest.send(ping(2));
    await settle();
    expect(good).toEqual([ping(1), ping(2)]);
    expect(alsoGood).toEqual([ping(1), ping(2)]);
  });

  it('a listener may unsubscribe itself while being called', async () => {
    const { guest, host } = makePair();
    const seen: SessionMessage[] = [];
    const stop = host.onMessage((message) => {
      seen.push(message);
      stop();
    });
    const other = collect(host);
    await guest.send(ping(1));
    await guest.send(ping(2));
    await settle();
    expect(seen).toEqual([ping(1)]);
    expect(other).toEqual([ping(1), ping(2)]);
  });

  it('onClose fires exactly once, with the remote-close reason, and not after unsubscribing', async () => {
    const { guest, host, guestEnd } = makePair();
    const calls: string[] = [];
    const removed: string[] = [];
    host.onClose((reason) => calls.push(reason));
    host.onClose((reason) => removed.push(reason))();
    await guest.close();
    await settle();
    expect(calls).toEqual(['remote-close']);
    expect(removed).toEqual([]);
    expect(guestEnd.closeCalls).toBe(1);
    await host.close(); // idempotent
    await settle();
    expect(calls).toEqual(['remote-close']);
  });

  it('a local close() reports local-close and closes the link exactly once, however often it is called', async () => {
    const { guest, guestEnd } = makePair();
    const calls = reasons(guest);
    await Promise.all([guest.close(), guest.close()]);
    await guest.close();
    await settle();
    expect(calls).toEqual(['local-close']);
    expect(guestEnd.closeCalls).toBe(1);
  });

  it('the transport reason is passed through (link drop)', async () => {
    const { host, hostEnd } = makePair();
    const calls = reasons(host);
    hostEnd.dropLink('network-lost');
    await settle();
    expect(calls).toEqual(['network-lost']);
    const error = await rejection(host.send(ping(1)));
    expect((error as ProtocolError).code).toBe('closed');
    expect((error as Error).message).toContain('network-lost');
  });

  it('a listener that subscribes after the close is told, asynchronously and once', async () => {
    const { guest } = makePair();
    await guest.close();
    const calls: string[] = [];
    let ranBeforeReturn = true;
    const stop = guest.onClose((reason) => {
      calls.push(reason);
      stop(); // would be a temporal-dead-zone error if called synchronously
    });
    ranBeforeReturn = calls.length > 0;
    expect(ranBeforeReturn).toBe(false);
    await settle();
    expect(calls).toEqual(['local-close']);
  });

  it('a late onClose listener that unsubscribes at once is never called', async () => {
    const { guest } = makePair();
    await guest.close();
    const calls: string[] = [];
    guest.onClose((reason) => calls.push(reason))();
    await settle();
    expect(calls).toEqual([]);
  });

  it('a throwing onClose listener does not stop the others', async () => {
    const { guest, host } = makePair();
    const calls: string[] = [];
    host.onClose(() => {
      throw new Error('close listener bug');
    });
    host.onClose((reason) => calls.push(reason));
    await guest.close();
    await settle();
    expect(calls).toEqual(['remote-close']);
  });

  it('send() after close rejects with ProtocolError closed, every time', async () => {
    const { guest } = makePair();
    await guest.close();
    for (let i = 0; i < 3; i++) {
      const error = await rejection(guest.send(ping(i)));
      expect(error).toBeInstanceOf(ProtocolError);
      expect((error as ProtocolError).code).toBe('closed');
    }
  });

  it('closing zeroises both key arrays', async () => {
    const pair = makePair();
    expect(pair.guestHeld.send.some((byte) => byte !== 0)).toBe(true);
    await pair.guest.close();
    expect(pair.guestHeld.send.every((byte) => byte === 0)).toBe(true);
    expect(pair.guestHeld.recv.every((byte) => byte === 0)).toBe(true);
    await settle();
    expect(pair.hostHeld.send.every((byte) => byte === 0)).toBe(true); // the peer closed because of the remote close
    expect(pair.hostHeld.recv.every((byte) => byte === 0)).toBe(true);
  });

  it('a protocol failure also zeroises the keys', async () => {
    const pair = makePair();
    pair.hostEnd.inject(wireFrame(pattern(32, 3), 0, ping(1)));
    await settle();
    expect(pair.hostHeld.send.every((byte) => byte === 0)).toBe(true);
    expect(pair.hostHeld.recv.every((byte) => byte === 0)).toBe(true);
  });
});

describe('SecureChannelImpl: sending', () => {
  /** A transport whose send() completes only when the test says so. */
  class ManualTransport implements ByteChannel {
    readonly calls: Uint8Array[] = [];
    isClosed = false;
    private readonly pending: ((error?: Error) => void)[] = [];
    send(data: Uint8Array): Promise<void> {
      this.calls.push(data);
      return new Promise<void>((resolve, reject) => {
        this.pending.push((error) => (error ? reject(error) : resolve()));
      });
    }
    onData(): Unsubscribe {
      return () => undefined;
    }
    onClose(): Unsubscribe {
      return () => undefined;
    }
    close(): Promise<void> {
      this.isClosed = true;
      return Promise.resolve();
    }
    complete(error?: Error): void {
      this.pending.shift()?.(error);
    }
  }

  function channelOver(transport: ByteChannel): SecureChannelImpl {
    const keys = freshKeys();
    return createSecureChannel({
      role: 'guest',
      channel: transport,
      decoder: new FrameDecoder(),
      crypto,
      sendKey: keys.guestToHost,
      recvKey: keys.hostToGuest,
      sendCounter: 0,
      recvCounter: 0,
    });
  }

  it('serialises sends: the next frame is not written before the previous write completed, counters follow wire order', async () => {
    const transport = new ManualTransport();
    const channel = channelOver(transport);
    const results = [channel.send(ping(1)), channel.send(ping(2)), channel.send(ping(3))];
    await settle();
    expect(transport.calls.length).toBe(1);
    transport.complete();
    await settle();
    expect(transport.calls.length).toBe(2);
    transport.complete();
    await settle();
    transport.complete();
    await Promise.all(results);
    expect(transport.calls.length).toBe(3);
    const keys = freshKeys();
    transport.calls.forEach((wire, counter) => {
      expect(bytesEqual(wire, wireFrame(keys.guestToHost, counter, ping(counter + 1)))).toBe(true);
    });
  });

  it('a failing write closes the channel with io-error and every queued send rejects with closed', async () => {
    const transport = new ManualTransport();
    const channel = channelOver(transport);
    const closes = reasons(channel);
    const first = rejection(channel.send(ping(1)));
    const second = rejection(channel.send(ping(2)));
    await settle();
    transport.complete(new Error('socket reset'));
    const [firstError, secondError] = await Promise.all([first, second]);
    expect((firstError as ProtocolError).code).toBe('closed');
    expect((secondError as ProtocolError).code).toBe('closed');
    expect(closes).toEqual(['io-error']);
    expect(transport.isClosed).toBe(true);
    expect(transport.calls.length).toBe(1); // the second frame was never written
  });

  it('a message the validator refuses is rejected up front: nothing is written, the channel stays open', async () => {
    const transport = new ManualTransport();
    const channel = channelOver(transport);
    for (const bad of [{ type: 'nope' }, { type: 'sdp', generation: 1 }, { type: 'peer-state' }, undefined]) {
      const error = await rejection(channel.send(bad as unknown as SessionMessage));
      expect((error as ProtocolError).code).toBe('malformed-frame');
    }
    expect(transport.calls.length).toBe(0);
    void channel.send(ping(1));
    await settle();
    expect(transport.calls.length).toBe(1);
    transport.complete();
  });

  it('snapshots the message at call time: later mutation by the caller cannot change what is sent', async () => {
    const transport = new ManualTransport();
    const channel = channelOver(transport);
    const message = { type: 'ping', id: 1, t: 1 } as { type: 'ping'; id: number; t: number };
    const sent = channel.send(message);
    message.id = 999;
    await settle();
    transport.complete();
    await sent;
    const keys = freshKeys();
    expect(
      bytesEqual(
        transport.calls[0] ?? new Uint8Array(),
        wireFrame(keys.guestToHost, 0, { type: 'ping', id: 1, t: 1 }),
      ),
    ).toBe(true);
  });

  it('a crypto provider that fails while sealing closes the channel instead of sending anything unauthenticated', async () => {
    const transport = new ManualTransport();
    const keys = freshKeys();
    const broken = {
      ...crypto,
      hmacSha256: () => {
        throw new Error('provider down');
      },
    };
    const channel = createSecureChannel({
      role: 'guest',
      channel: transport,
      decoder: new FrameDecoder(),
      crypto: broken,
      sendKey: keys.guestToHost,
      recvKey: keys.hostToGuest,
      sendCounter: 0,
      recvCounter: 0,
    });
    const closes = reasons(channel);
    const error = await rejection(channel.send(ping(1)));
    expect((error as ProtocolError).code).toBe('closed');
    expect(transport.calls.length).toBe(0);
    expect(closes).toEqual(['closed']);
    expect(transport.isClosed).toBe(true);
  });

  it('a crypto provider that fails while verifying closes the channel (fail closed) without throwing into the link', async () => {
    const pair = makePair();
    const keys = freshKeys();
    const broken = {
      ...crypto,
      timingSafeEqual: () => {
        throw new Error('provider down');
      },
    };
    const pipe = createMemoryPipe();
    const channel = createSecureChannel({
      role: 'host',
      channel: pipe.b,
      decoder: new FrameDecoder(),
      crypto: broken,
      sendKey: keys.hostToGuest,
      recvKey: keys.guestToHost,
      sendCounter: 0,
      recvCounter: 0,
    });
    const closes = reasons(channel);
    pipe.b.inject(wireFrame(keys.guestToHost, 0, ping(1)));
    await settle();
    expect(closes).toEqual(['closed']);
    await pair.guest.close();
  });
});

describe('SecureChannelImpl: handover from the handshake', () => {
  it('processes frames that were already buffered in the decoder when it took over', async () => {
    const pipe = createMemoryPipe();
    const keys = freshKeys();
    const decoder = new FrameDecoder();
    decoder.push(
      concatBytes(wireFrame(keys.guestToHost, 0, ping(1)), wireFrame(keys.guestToHost, 1, ping(2))),
    );
    const channel = createSecureChannel({
      role: 'host',
      channel: pipe.b,
      decoder,
      crypto,
      sendKey: keys.hostToGuest,
      recvKey: keys.guestToHost,
      sendCounter: 0,
      recvCounter: 0,
    });
    const got = collect(channel);
    expect(got).toEqual([ping(1), ping(2)]);
  });

  it('a bad frame already buffered closes the channel immediately, and late subscribers still learn why', async () => {
    const pipe = createMemoryPipe();
    const keys = freshKeys();
    const decoder = new FrameDecoder();
    decoder.push(wireFrame(pattern(32, 1), 0, ping(1)));
    const channel = createSecureChannel({
      role: 'host',
      channel: pipe.b,
      decoder,
      crypto,
      sendKey: keys.hostToGuest,
      recvKey: keys.guestToHost,
      sendCounter: 0,
      recvCounter: 0,
    });
    expect(channel.closeError?.code).toBe('bad-mac');
    expect(pipe.b.closeCalls).toBe(1);
    const closes = reasons(channel);
    await settle();
    expect(closes).toEqual(['bad-mac']);
  });

  it('starts from the counters it is given (guest after ready: send 0, receive 1)', async () => {
    const pipe = createMemoryPipe();
    const keys = freshKeys();
    const channel = createSecureChannel({
      role: 'guest',
      channel: pipe.a,
      decoder: new FrameDecoder(),
      crypto,
      sendKey: keys.guestToHost,
      recvKey: keys.hostToGuest,
      sendCounter: 0,
      recvCounter: 1,
    });
    const got = collect(channel);
    pipe.a.inject(wireFrame(keys.hostToGuest, 1, ping(1)));
    await settle();
    expect(got).toEqual([ping(1)]);
    await channel.send(ping(2));
    expect(bytesEqual(pipe.a.sent[0] ?? new Uint8Array(), wireFrame(keys.guestToHost, 0, ping(2)))).toBe(
      true,
    );
  });
});
