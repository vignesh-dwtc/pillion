import type { IceCandidateInit, MediaConnectionState } from '../../../platform/media/MediaEngine';
import { DEFAULT_AUDIO_TUNABLES } from '../../../platform/audio/AudioTunables';
import { FakeNetwork } from './FakeNetwork';
import { createFakeMediaPair, type FakeMediaOptions, type FakeMediaSession } from './FakeMediaEngine';
import { ManualClock } from './ManualClock';

function setup(options: Partial<FakeMediaOptions> = {}) {
  const clock = new ManualClock();
  const network = new FakeNetwork();
  const pair = createFakeMediaPair({ clock, network, ...options });
  return { clock, network, ...pair };
}

async function startBoth(env: ReturnType<typeof setup>): Promise<void> {
  await env.host.start({ tunables: DEFAULT_AUDIO_TUNABLES, startMuted: false });
  await env.guest.start({ tunables: DEFAULT_AUDIO_TUNABLES, startMuted: false });
}

function watch(session: FakeMediaSession): {
  states: MediaConnectionState[];
  candidates: (IceCandidateInit | null)[];
} {
  const states: MediaConnectionState[] = [];
  const candidates: (IceCandidateInit | null)[] = [];
  session.onState((s) => states.push(s));
  session.onLocalCandidate((c) => candidates.push(c));
  return { states, candidates };
}

/** Plays the signaling by hand: offer, answer, then every candidate in both directions. */
async function negotiate(
  env: ReturnType<typeof setup>,
  options: { candidates?: boolean } = {},
): Promise<{
  h: FakeMediaSession;
  g: FakeMediaSession;
  hw: ReturnType<typeof watch>;
  gw: ReturnType<typeof watch>;
}> {
  await startBoth(env);
  const h = (await env.host.createSession()) as FakeMediaSession;
  const g = (await env.guest.createSession()) as FakeMediaSession;
  const hw = watch(h);
  const gw = watch(g);
  const offer = await h.createOffer();
  const answer = await g.acceptOffer(offer);
  await h.acceptAnswer(answer);
  await env.clock.settle();
  if (options.candidates !== false) {
    for (const c of hw.candidates) await g.addRemoteCandidate(c);
    for (const c of gw.candidates) await h.addRemoteCandidate(c);
  }
  await env.clock.settle();
  return { h, g, hw, gw };
}

describe('negotiation', () => {
  it('connects both sessions once SDP and candidates were exchanged in both directions', async () => {
    const env = setup();
    const { h, g, hw, gw } = await negotiate(env);
    expect(h.state).toBe('connected');
    expect(g.state).toBe('connected');
    expect(hw.states).toEqual(['checking', 'connected']);
    expect(gw.states).toEqual(['checking', 'connected']);
    expect(hw.candidates.filter((c) => c !== null)).toHaveLength(2);
    expect(hw.candidates[hw.candidates.length - 1]).toBeNull(); // end-of-candidates
  });

  it('stays in checking while no candidate has arrived', async () => {
    const env = setup();
    const { h, g } = await negotiate(env, { candidates: false });
    expect(h.state).toBe('checking');
    expect(g.state).toBe('checking');
    await env.clock.advance(60_000);
    expect(h.state).toBe('checking');
  });

  it('honours connectDelayMs on the clock', async () => {
    const env = setup({ connectDelayMs: 500 });
    const { h } = await negotiate(env);
    expect(h.state).toBe('checking');
    await env.clock.advance(499);
    expect(h.state).toBe('checking');
    await env.clock.advance(1);
    expect(h.state).toBe('connected');
  });

  it('is as strict as a browser about ordering and provenance', async () => {
    const env = setup();
    await startBoth(env);
    const h = await env.host.createSession();
    const g = await env.guest.createSession();
    const candidate = {
      candidate: 'candidate:fake-x 1 udp 1 10.0.0.1 5000 typ host',
      sdpMid: '0',
      sdpMLineIndex: 0,
    };
    await expect(h.addRemoteCandidate(candidate)).rejects.toMatchObject({ code: 'negotiation-failed' });
    await expect(h.acceptAnswer({ type: 'answer', sdp: 'a=fake-session:x' })).rejects.toMatchObject({
      code: 'negotiation-failed',
    });
    await expect(g.acceptOffer({ type: 'offer', sdp: 'v=0 not from a fake session' })).rejects.toMatchObject({
      code: 'negotiation-failed',
    });
    await expect(g.acceptOffer({ type: 'answer', sdp: 'a=fake-session:x' })).rejects.toMatchObject({
      code: 'negotiation-failed',
    });
    const offer = await h.createOffer();
    await g.acceptOffer(offer);
    await expect(
      g.addRemoteCandidate({
        candidate: 'candidate:real 1 udp 1 1.2.3.4 5 typ host',
        sdpMid: null,
        sdpMLineIndex: null,
      }),
    ).rejects.toMatchObject({ code: 'negotiation-failed' });
  });

  it('does not connect when the network path is down, and connects when it returns', async () => {
    const env = setup();
    env.network.setUp(false);
    const { h, g } = await negotiate(env);
    expect(h.state).toBe('checking');
    env.network.setUp(true);
    await env.clock.settle();
    expect(h.state).toBe('connected');
    expect(g.state).toBe('connected');
  });
});

describe('losing the path', () => {
  it('goes disconnected then failed after failAfterMs, and a restored path before that heals it', async () => {
    const env = setup({ failAfterMs: 2000 });
    const { h, hw } = await negotiate(env);
    env.network.setUp(false);
    await env.clock.settle();
    expect(h.state).toBe('disconnected');
    await env.clock.advance(1999);
    expect(h.state).toBe('disconnected');
    env.network.setUp(true);
    await env.clock.settle();
    expect(h.state).toBe('connected');
    await env.clock.advance(10_000);
    expect(h.state).toBe('connected');
    expect(hw.states).toEqual(['checking', 'connected', 'disconnected', 'connected']);

    env.network.setUp(false);
    await env.clock.advance(2000);
    expect(h.state).toBe('failed');
    env.network.setUp(true);
    await env.clock.settle();
    expect(h.state).toBe('failed'); // failed is final
  });

  it('with failAfterMs null never fails by itself', async () => {
    const env = setup({ failAfterMs: null });
    const { h } = await negotiate(env);
    env.network.setUp(false);
    await env.clock.advance(600_000);
    expect(h.state).toBe('disconnected');
  });

  it('a black hole counts as a lost path too', async () => {
    const env = setup();
    const { h } = await negotiate(env);
    env.network.setBlackhole(true);
    await env.clock.settle();
    expect(h.state).toBe('disconnected');
  });

  it('closing one session tells the partner session, like a vanished peer connection', async () => {
    const env = setup();
    const { h, g, gw } = await negotiate(env);
    await h.close();
    await env.clock.settle();
    expect(g.state).toBe('disconnected');
    await env.clock.advance(2000);
    expect(g.state).toBe('failed');
    expect(gw.states[gw.states.length - 1]).toBe('failed');
  });

  it('forceState lets a test fail a session the way ICE would', async () => {
    const env = setup();
    const { h, hw } = await negotiate(env);
    h.forceState('failed');
    expect(hw.states[hw.states.length - 1]).toBe('failed');
  });
});

describe('session lifecycle and stats', () => {
  it('close is idempotent, emits closed once, stops events and rejects further use', async () => {
    const env = setup();
    const { h, g, hw } = await negotiate(env);
    await h.close();
    await h.close();
    expect(h.closeCalls).toBe(2);
    expect(hw.states.filter((s) => s === 'closed')).toHaveLength(1);
    await expect(h.createOffer()).rejects.toMatchObject({ code: 'closed' });
    await expect(h.getStats()).rejects.toMatchObject({ code: 'closed' });
    await g.close();
    expect(env.clock.pendingTimers()).toBe(0);
  });

  it('reports counters that grow with connected time, and an override for tests', async () => {
    const env = setup();
    const { h } = await negotiate(env);
    const first = await h.getStats();
    await env.clock.advance(2000);
    const second = await h.getStats();
    expect(second.bytesSent - first.bytesSent).toBe(6000);
    expect(second.packetsReceived - first.packetsReceived).toBe(100);
    expect(second.connectionState).toBe('connected');
    expect(second.selectedPair?.local.type).toBe('host');
    expect(second.localCandidates.length).toBeGreaterThan(0);
    h.setStats({ packetsLost: 7, rttMs: 99 });
    expect(await h.getStats()).toMatchObject({ packetsLost: 7, rttMs: 99 });
  });

  it('stops counting while disconnected', async () => {
    const env = setup({ failAfterMs: null });
    const { h } = await negotiate(env);
    await env.clock.advance(1000);
    env.network.setUp(false);
    await env.clock.settle();
    const during = await h.getStats();
    await env.clock.advance(5000);
    const later = await h.getStats();
    expect(later.bytesSent).toBe(during.bytesSent);
    expect(later.selectedPair).toBeNull();
  });
});

describe('FakeMediaEngine', () => {
  it('needs start() before sessions, remembers its start options and mute, and stop() closes every session', async () => {
    const env = setup();
    await expect(env.host.createSession()).rejects.toMatchObject({ code: 'closed' });
    await env.host.start({ tunables: DEFAULT_AUDIO_TUNABLES, startMuted: true });
    expect(env.host.muted).toBe(true);
    expect(env.host.startOptions?.startMuted).toBe(true);
    env.host.setMuted(false);
    expect(env.host.mutedCalls).toEqual([false]);
    const a = await env.host.createSession();
    await env.host.createSession();
    expect(env.host.openSessions).toBe(2);
    await env.host.stop();
    expect(env.host.stopCalls).toBe(1);
    expect(env.host.openSessions).toBe(0);
    expect(env.host.started).toBe(false);
    await expect(a.getStats()).rejects.toMatchObject({ code: 'closed' });
  });

  it('fails on command: start, the next session, and hangs', async () => {
    const env = setup();
    env.host.failStart();
    await expect(
      env.host.start({ tunables: DEFAULT_AUDIO_TUNABLES, startMuted: false }),
    ).rejects.toMatchObject({
      code: 'capture-failed',
    });
    await env.guest.start({ tunables: DEFAULT_AUDIO_TUNABLES, startMuted: false });
    env.guest.failNextSession();
    await expect(env.guest.createSession()).rejects.toMatchObject({ code: 'negotiation-failed' });
    await expect(env.guest.createSession()).resolves.toBeDefined();
    env.guest.hangCreateSession();
    let settled = false;
    void env.guest.createSession().then(() => (settled = true));
    await env.clock.advance(60_000);
    expect(settled).toBe(false);
  });

  it('tracks the newest open session', async () => {
    const env = setup();
    await startBoth(env);
    expect(env.host.currentSession).toBeUndefined();
    const a = await env.host.createSession();
    const b = await env.host.createSession();
    expect(env.host.currentSession).toBe(b);
    await b.close();
    expect(env.host.currentSession).toBe(a);
    expect(env.fabric.openSessions).toBe(1);
  });
});
