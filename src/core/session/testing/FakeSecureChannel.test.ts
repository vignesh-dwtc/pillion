import type { LinkChannel } from '../../../platform/link/LinkTransport';
import type { SessionMessage } from '../../protocol/messages';
import { ProtocolError, type EstablishSecureChannel, type SecureChannel } from '../../protocol/secureChannel';
import { decodeBase64Url } from '../base64url';
import {
  createFakeEstablish,
  establishFakeSecureChannel,
  type FakeEstablishOptions,
} from './FakeSecureChannel';
import { createInMemoryLinkPair, type InMemoryLinkOptions } from './InMemoryLinkTransport';
import { ManualClock } from './ManualClock';
import { makeTestPairing } from './pairingFixtures';
import { createSeededCrypto } from './seededRandom';

const TIMEOUT = 5000;

function setup(link: Partial<InMemoryLinkOptions> = {}) {
  const clock = new ManualClock();
  const pair = createInMemoryLinkPair({ clock, ...link });
  const hostPairing = makeTestPairing('host');
  const guestPairing = makeTestPairing('guest');
  const crypto = createSeededCrypto(9);

  async function channels(): Promise<{ host: LinkChannel; guest: LinkChannel }> {
    const h = pair.host.open({ role: 'host', pairId: hostPairing.pairId, timeoutMs: 1000 });
    const g = pair.guest.open({ role: 'guest', pairId: guestPairing.pairId, timeoutMs: 1000 });
    await clock.settle();
    return { host: await h, guest: await g };
  }

  const options = (pairing: typeof hostPairing, role: 'host' | 'guest') => ({
    role,
    pairId: pairing.pairId,
    secret: decodeBase64Url(pairing.secret) as Uint8Array,
    crypto,
    handshakeTimeoutMs: TIMEOUT,
    setTimeout: (fn: () => void, ms: number) => clock.setTimeout(fn, ms),
    clearTimeout: (handle: unknown) => clock.clearTimeout(handle),
  });

  async function handshake(
    hostEstablish: EstablishSecureChannel = establishFakeSecureChannel,
    guestEstablish: EstablishSecureChannel = establishFakeSecureChannel,
    guestPairingOverride = guestPairing,
  ): Promise<{
    host: Promise<SecureChannel>;
    guest: Promise<SecureChannel>;
    hostLink: LinkChannel;
    guestLink: LinkChannel;
  }> {
    const { host, guest } = await channels();
    const hostP = hostEstablish(host, options(hostPairing, 'host'));
    const guestP = guestEstablish(guest, options(guestPairingOverride, 'guest'));
    // keep unhandled rejections away while tests inspect the outcomes later
    hostP.catch(() => undefined);
    guestP.catch(() => undefined);
    return { host: hostP, guest: guestP, hostLink: host, guestLink: guest };
  }

  return { clock, ...pair, hostPairing, guestPairing, handshake, channels, options };
}

const peerState = (name: string): SessionMessage => ({
  type: 'peer-state',
  name,
  muted: false,
  headsetConnected: true,
  batteryPct: 50,
  charging: false,
  interruption: 'none',
});

describe.each([
  ['whole chunks', { chunking: { mode: 'whole' } }],
  ['one byte at a time', { chunking: { mode: 'fixed', size: 1 } }],
  [
    'random chunks, coalesced, with latency',
    { chunking: { mode: 'random', min: 1, max: 11, seed: 5 }, coalesce: true, latencyMs: 7 },
  ],
] as [string, Partial<InMemoryLinkOptions>][])('handshake and messages over %s', (_name, link) => {
  it('establishes both ends and carries messages in order in both directions', async () => {
    const env = setup(link);
    const { host: hostP, guest: guestP } = await env.handshake();
    await env.clock.advance(500);
    const [host, guest] = [await hostP, await guestP];
    const toHost: SessionMessage[] = [];
    const toGuest: SessionMessage[] = [];
    host.onMessage((m) => toHost.push(m));
    guest.onMessage((m) => toGuest.push(m));
    for (let i = 0; i < 5; i += 1) {
      await guest.send(peerState(`guest-${i}`));
      await host.send(peerState(`host-${i}`));
    }
    await env.clock.advance(500);
    expect(toHost.map((m) => (m as { name: string }).name)).toEqual([
      'guest-0',
      'guest-1',
      'guest-2',
      'guest-3',
      'guest-4',
    ]);
    expect(toGuest.map((m) => (m as { name: string }).name)).toEqual([
      'host-0',
      'host-1',
      'host-2',
      'host-3',
      'host-4',
    ]);
    expect(host.role).toBe('host');
    expect(guest.role).toBe('guest');
  });
});

describe('handshake failures', () => {
  it('a wrong secret ends both sides with bad-proof and closes the link', async () => {
    const env = setup();
    const { host, guest, hostLink } = await env.handshake(
      undefined,
      undefined,
      makeTestPairing('guest', { secretByte: 0x99 }),
    );
    // same pair id, different secret
    const hostResult = host.then(
      () => 'ok',
      (e: unknown) => e,
    );
    const guestResult = guest.then(
      () => 'ok',
      (e: unknown) => e,
    );
    await env.clock.settle();
    expect(await hostResult).toBeInstanceOf(ProtocolError);
    expect(((await hostResult) as ProtocolError).code).toBe('bad-proof');
    expect(((await guestResult) as ProtocolError).code).toBe('bad-proof');
    void hostLink;
    expect(env.hub.liveChannels()).toBeNull();
  });

  it('an unknown pair id is rejected by the host before any proof is checked', async () => {
    const env = setup();
    const hostEnd = env.host.open({ role: 'host', pairId: 'shared', timeoutMs: 1000 });
    const guestEnd = env.guest.open({ role: 'guest', pairId: 'shared', timeoutMs: 1000 });
    await env.clock.settle();
    const [h, g] = [await hostEnd, await guestEnd];
    const other = makeTestPairing('guest', { pairIdByte: 0x77 });
    const hostP = establishFakeSecureChannel(h, env.options(env.hostPairing, 'host'));
    const guestP = establishFakeSecureChannel(g, env.options(other, 'guest'));
    const results = await Promise.all([hostP.catch((e: unknown) => e), guestP.catch((e: unknown) => e)]);
    expect((results[0] as ProtocolError).code).toBe('unknown-pair');
    expect((results[1] as ProtocolError).code).toBe('unknown-pair');
  });

  it('a version mismatch is reported as unsupported-version on both sides', async () => {
    const env = setup();
    const { host, guest } = await env.handshake(
      createFakeEstablish({ version: 1 }),
      createFakeEstablish({ version: 2 }),
    );
    const results = await Promise.all([host.catch((e: unknown) => e), guest.catch((e: unknown) => e)]);
    expect((results[0] as ProtocolError).code).toBe('unsupported-version');
    expect((results[1] as ProtocolError).code).toBe('unsupported-version');
  });

  it('a peer that never answers ends in handshake-timeout exactly at the deadline, on the injected clock', async () => {
    const env = setup();
    const { host, guest } = await env.handshake(
      createFakeEstablish({ stall: true }),
      createFakeEstablish({ stall: true }),
    );
    const outcomes: unknown[] = [];
    void host.catch((e: unknown) => outcomes.push(e));
    void guest.catch((e: unknown) => outcomes.push(e));
    await env.clock.advance(TIMEOUT - 1);
    expect(outcomes).toHaveLength(0);
    await env.clock.advance(1);
    expect(outcomes).toHaveLength(2);
    const codes = outcomes.map((e) => (e as ProtocolError).code).sort();
    // The first to time out closes the link, so the other one may hear "closed" a moment before its own deadline.
    expect(codes).toContain('handshake-timeout');
    expect(codes.every((code) => code === 'handshake-timeout' || code === 'closed')).toBe(true);
    expect(env.clock.pendingTimers()).toBe(0);
  });

  it('the link closing mid-handshake rejects with closed', async () => {
    const env = setup({ latencyMs: 50 });
    const { host, guest } = await env.handshake();
    env.hub.dropLink('io-error');
    const results = await Promise.all([host.catch((e: unknown) => e), guest.catch((e: unknown) => e)]);
    expect((results[0] as ProtocolError).code).toBe('closed');
    expect((results[1] as ProtocolError).code).toBe('closed');
  });
});

describe('an open channel', () => {
  async function open(settings: { host?: FakeEstablishOptions; guest?: FakeEstablishOptions } = {}) {
    const env = setup();
    const { host, guest } = await env.handshake(
      createFakeEstablish(settings.host),
      createFakeEstablish(settings.guest),
    );
    await env.clock.settle();
    return { env, host: await host, guest: await guest };
  }

  it('reports a remote close with the transport reason, and a local close as local-close', async () => {
    const { env, host, guest } = await open();
    const hostCloses: string[] = [];
    const guestCloses: string[] = [];
    host.onClose((r) => hostCloses.push(r));
    guest.onClose((r) => guestCloses.push(r));
    await host.close();
    await env.clock.settle();
    expect(hostCloses).toEqual(['local-close']);
    expect(guestCloses).toEqual(['remote-close']);
    await expect(host.send(peerState('x'))).rejects.toMatchObject({ code: 'closed' });
    await expect(guest.send(peerState('x'))).rejects.toMatchObject({ code: 'closed' });
  });

  it('a network drop closes with network-lost', async () => {
    const { env, host, guest } = await open();
    const reasons: string[] = [];
    host.onClose((r) => reasons.push(r));
    guest.onClose((r) => reasons.push(r));
    env.hub.dropLink('network-lost');
    await env.clock.settle();
    expect(reasons).toEqual(['network-lost', 'network-lost']);
  });

  it('queues messages that arrive before the first subscription by default', async () => {
    const { env, host, guest } = await open();
    await host.send(peerState('early'));
    await env.clock.settle();
    const seen: string[] = [];
    guest.onMessage((m) => seen.push((m as { name: string }).name));
    expect(seen).toEqual(['early']);
  });

  it('with dropUnsubscribed, a message that arrives before the first subscription is lost (strict mode)', async () => {
    const { env, host, guest } = await open({ guest: { dropUnsubscribed: true } });
    await host.send(peerState('early'));
    await env.clock.settle();
    const seen: string[] = [];
    guest.onMessage((m) => seen.push((m as { name: string }).name));
    await host.send(peerState('late'));
    await env.clock.settle();
    expect(seen).toEqual(['late']);
  });

  it('garbage bytes after the handshake close the channel with malformed-frame', async () => {
    const { env, host } = await open();
    const reasons: string[] = [];
    host.onClose((r) => reasons.push(r));
    const live = env.hub.liveChannels();
    const body = new TextEncoder().encode('{not json');
    const frame = new Uint8Array(4 + body.length);
    new DataView(frame.buffer).setUint32(0, body.length);
    frame.set(body, 4);
    live?.host.injectIncoming(frame);
    await env.clock.settle();
    expect(reasons).toEqual(['malformed-frame']);
  });

  it('unsubscribed listeners hear nothing', async () => {
    const { env, host, guest } = await open();
    const seen: string[] = [];
    const off = guest.onMessage((m) => seen.push((m as { name: string }).name));
    await host.send(peerState('one'));
    await env.clock.settle();
    off();
    await host.send(peerState('two'));
    await env.clock.settle();
    expect(seen).toEqual(['one']);
  });
});
