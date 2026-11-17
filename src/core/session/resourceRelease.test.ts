import * as base64url from './base64url';
import { FakeMediaSession, createTwoPeerHarness, tapEstablish, establishFakeSecureChannel } from './testing';
import type { PeerRig, TwoPeerHarness } from './testing';
import type { Clock } from '../common/types';
import type { SessionMessage } from '../protocol/messages';

/**
 * Mutation-driven tests: every resource a ride acquires is released on every way a ride can end, the backoff
 * restarts after a recovery, and stale-generation signaling never reaches the media session.
 */

const clockStub = { now: () => 0 } as unknown as Clock;

async function connect(h: TwoPeerHarness): Promise<void> {
  await h.startBoth();
  await h.runUntil(() => h.bothConnected(), { label: 'both connected' });
}

/** Captures the decoded 32-byte pairing secret buffers the controllers hold (the only copy they keep). */
function captureSecrets(): { buffers: Uint8Array[]; restore: () => void } {
  const real = base64url.decodeBase64Url;
  const buffers: Uint8Array[] = [];
  const spy = jest.spyOn(base64url, 'decodeBase64Url').mockImplementation((text: string) => {
    const out = real(text);
    if (out !== null && out.length === 32) buffers.push(out);
    return out;
  });
  return { buffers, restore: () => spy.mockRestore() };
}

function isZeroed(bytes: Uint8Array): boolean {
  return bytes.every((b) => b === 0);
}

interface ReleaseExpectations {
  /** media.stop() calls: 1 when the microphone start was attempted, else 0. */
  mediaStops: number;
  audioStarted: boolean;
  serviceStarted: boolean;
}

function expectReleased(rig: PeerRig, expected: ReleaseExpectations): void {
  expect(rig.snapshot().state).toBe('ended');
  expect(rig.link.disposed).toBe(true);
  expect(rig.media.stopCalls).toBe(expected.mediaStops);
  expect(rig.media.started).toBe(false);
  expect(rig.media.openSessions).toBe(0);
  expect(rig.audio.isRunning).toBe(false);
  expect(rig.audio.stopCalls).toBe(expected.audioStarted ? 1 : 0);
  expect(rig.audio.listenerCount).toBe(0);
  expect(rig.service.running).toBe(false);
  expect(rig.service.stopCalls).toBe(expected.serviceStarted ? 1 : 0);
  expect(rig.service.listenerCount).toBe(0);
}

const ALL_STARTED: ReleaseExpectations = { mediaStops: 1, audioStarted: true, serviceStarted: true };

describe('resource release: a ride that ends releases everything', () => {
  let secrets: ReturnType<typeof captureSecrets>;
  beforeEach(() => {
    secrets = captureSecrets();
  });
  afterEach(() => {
    secrets.restore();
  });

  it('end() on one side releases both phones completely (partner ends through bye)', async () => {
    const h = createTwoPeerHarness({ seed: 31 });
    await connect(h);
    expect(secrets.buffers).toHaveLength(2);
    for (const buffer of secrets.buffers) expect(isZeroed(buffer)).toBe(false);
    // While connected, timers exist (heartbeats, battery poll): the check below is meaningful.
    expect(h.clock.pendingTimers()).toBeGreaterThan(0);
    expect(h.host.media.stopCalls).toBe(0);

    await h.host.controller.end();
    await h.runUntil(() => h.guest.snapshot().state === 'ended', { label: 'guest ended by bye' });
    await h.settle();

    expect(h.guest.snapshot().error?.code).toBe('partner-ended');
    expectReleased(h.host, ALL_STARTED);
    expectReleased(h.guest, ALL_STARTED);
    expect(h.clock.pendingTimers()).toBe(0);
    for (const buffer of secrets.buffers) expect(isZeroed(buffer)).toBe(true);
  });

  it('end() by the guest releases both phones completely too, and a second end() changes nothing', async () => {
    const h = createTwoPeerHarness({ seed: 32 });
    await connect(h);
    await h.guest.controller.end();
    await h.runUntil(() => h.host.snapshot().state === 'ended', { label: 'host ended by bye' });
    await h.guest.controller.end();
    await h.host.controller.end();
    await h.settle();
    expect(h.host.snapshot().error?.code).toBe('partner-ended');
    expectReleased(h.host, ALL_STARTED);
    expectReleased(h.guest, ALL_STARTED);
    expect(h.clock.pendingTimers()).toBe(0);
    for (const buffer of secrets.buffers) expect(isZeroed(buffer)).toBe(true);
  });

  it('end() during an outage releases everything (no retry timer, no battery timer left)', async () => {
    const h = createTwoPeerHarness({ seed: 33 });
    await connect(h);
    h.network.setUp(false);
    await h.runUntil(() => h.host.snapshot().state === 'reconnecting', { label: 'host reconnecting' });
    await h.host.controller.end();
    await h.guest.controller.end();
    await h.settle();
    expectReleased(h.host, ALL_STARTED);
    expectReleased(h.guest, ALL_STARTED);
    expect(h.clock.pendingTimers()).toBe(0);
    for (const buffer of secrets.buffers) expect(isZeroed(buffer)).toBe(true);
  });

  it('the battery poll timer is cancelled by end() even right after start', async () => {
    const h = createTwoPeerHarness({ seed: 34 });
    await h.host.start();
    await h.runUntil(() => h.host.service.running, { label: 'service running' });
    await h.settle();
    expect(h.clock.pendingTimers()).toBeGreaterThan(0);
    await h.host.controller.end();
    await h.settle();
    expect(h.clock.pendingTimers()).toBe(0);
    expectReleased(h.host, ALL_STARTED);
  });

  it('a fatal media-failed ending releases audio, service and link, and zeroes the secret', async () => {
    const h = createTwoPeerHarness();
    h.host.media.failStart();
    await h.host.start();
    await h.runUntil(() => h.host.snapshot().state === 'ended', { label: 'host ended for capture failure' });
    await h.settle();
    expect(h.host.snapshot().error?.code).toBe('media-failed');
    expectReleased(h.host, ALL_STARTED);
    expect(h.clock.pendingTimers()).toBe(0);
    expect(secrets.buffers).toHaveLength(1);
    expect(isZeroed(secrets.buffers[0] ?? new Uint8Array([1]))).toBe(true);
  });

  it('a fatal service-failed ending releases the audio route and the link', async () => {
    const h = createTwoPeerHarness();
    h.host.service.failStart();
    await h.host.start();
    await h.runUntil(() => h.host.snapshot().state === 'ended', { label: 'host ended for service failure' });
    await h.settle();
    expect(h.host.snapshot().error?.code).toBe('service-failed');
    expectReleased(h.host, { mediaStops: 0, audioStarted: true, serviceStarted: true });
    expect(h.clock.pendingTimers()).toBe(0);
    expect(isZeroed(secrets.buffers[0] ?? new Uint8Array([1]))).toBe(true);
  });

  it('a fatal no-headset ending releases the audio route and the link', async () => {
    const h = createTwoPeerHarness({ guestHeadset: false });
    await h.guest.start();
    await h.runUntil(() => h.guest.snapshot().state === 'ended', { label: 'guest ended for no headset' });
    await h.settle();
    expect(h.guest.snapshot().error?.code).toBe('no-headset');
    expectReleased(h.guest, { mediaStops: 0, audioStarted: true, serviceStarted: false });
    expect(h.clock.pendingTimers()).toBe(0);
    expect(isZeroed(secrets.buffers[0] ?? new Uint8Array([1]))).toBe(true);
  });

  it('a permission-denied ending still disposes the link and zeroes the secret', async () => {
    const h = createTwoPeerHarness();
    h.host.permissions.set('microphone', 'blocked');
    await h.host.start();
    await h.runUntil(() => h.host.snapshot().state === 'ended', { label: 'host ended for permission' });
    await h.settle();
    expectReleased(h.host, { mediaStops: 0, audioStarted: false, serviceStarted: false });
    expect(h.clock.pendingTimers()).toBe(0);
    expect(isZeroed(secrets.buffers[0] ?? new Uint8Array([1]))).toBe(true);
  });
});

describe('backoff at the controller level', () => {
  it('restarts from initialMs after a recovery (second outage starts with a short retry gap)', async () => {
    const h = createTwoPeerHarness({ seed: 8, link: { whenDown: 'unavailable' } });
    await connect(h);

    // First outage, long enough to reach the maximum delay.
    h.linkHub.dropLink('network-lost');
    h.network.setUp(false);
    await h.advance(60_000);
    const firstOutage = h.linkHub.openTimes.host;
    const lastGaps = firstOutage.slice(-4).map((t, i, all) => t - (all[i - 1] ?? t));
    expect(Math.max(...lastGaps.slice(1))).toBeGreaterThanOrEqual(2_400 - 100);
    h.network.setUp(true);
    await h.runUntil(() => h.bothConnected(), { label: 'recovered from the long outage' });

    // Second outage.
    await h.advance(5_000);
    const opensBefore = h.linkHub.openTimes.host.length;
    const droppedAt = h.clock.now();
    h.linkHub.dropLink('network-lost');
    h.network.setUp(false);
    await h.advance(10_000);
    const opens = h.linkHub.openTimes.host.slice(opensBefore);
    expect(opens.length).toBeGreaterThanOrEqual(2);
    const initialMs = 500;
    // First retry after the drop: initialMs +/- 20% jitter (plus scheduling slack), nowhere near the 3000 ms cap.
    expect((opens[0] ?? 0) - droppedAt).toBeLessThanOrEqual(initialMs * 1.2 + 200);
    // And the second one is still on the growing part of the curve.
    expect((opens[1] ?? 0) - (opens[0] ?? 0)).toBeLessThan(2_000);
    await h.host.controller.end();
    await h.guest.controller.end();
  });
});

describe('stale generations are dropped before they reach the media session', () => {
  it('ignores authenticated sdp answers and ice candidates carrying an old generation', async () => {
    const answers: string[] = [];
    const candidates: string[] = [];
    const realAnswer = FakeMediaSession.prototype.acceptAnswer;
    const realCandidate = FakeMediaSession.prototype.addRemoteCandidate;
    const answerSpy = jest.spyOn(FakeMediaSession.prototype, 'acceptAnswer').mockImplementation(function (
      this: FakeMediaSession,
      answer,
    ) {
      answers.push(answer.sdp);
      return realAnswer.call(this, answer);
    });
    const candidateSpy = jest
      .spyOn(FakeMediaSession.prototype, 'addRemoteCandidate')
      .mockImplementation(function (this: FakeMediaSession, candidate) {
        candidates.push(candidate?.candidate ?? 'end-of-candidates');
        return realCandidate.call(this, candidate);
      });
    try {
      const rewrite = (_from: 'host' | 'guest', m: SessionMessage): SessionMessage[] | undefined => {
        // From the second negotiation on (generation >= 2) an older, valid generation exists to replay.
        if (m.type === 'sdp' && m.kind === 'answer' && m.generation >= 2) {
          return [{ ...m, generation: m.generation - 1, sdp: `${m.sdp}a=stale-marker\r\n` }, m];
        }
        if (m.type === 'ice' && m.candidate !== null && m.generation >= 2) {
          return [
            {
              ...m,
              generation: m.generation - 1,
              candidate: { ...m.candidate, candidate: 'fake-stale-marker' },
            },
            m,
          ];
        }
        return undefined;
      };
      const h = createTwoPeerHarness({
        seed: 41,
        establish: tapEstablish(establishFakeSecureChannel, { clock: clockStub, records: [], rewrite }),
      });
      await connect(h);
      const generation = h.host.snapshot().generation;
      h.linkHub.dropLink('io-error');
      await h.runUntil(() => h.bothConnected() && h.host.snapshot().generation > generation, {
        label: 'second negotiation connected',
      });
      expect(h.host.snapshot().generation).toBeGreaterThanOrEqual(2);
      // The genuine messages were applied ...
      expect(answers.length).toBeGreaterThanOrEqual(2);
      expect(candidates.some((c) => c.includes('fake-') && !c.includes('stale-marker'))).toBe(true);
      // ... the stale ones never.
      expect(answers.filter((sdp) => sdp.includes('stale-marker'))).toEqual([]);
      expect(candidates.filter((c) => c.includes('stale-marker'))).toEqual([]);
      await h.host.controller.end();
      await h.guest.controller.end();
    } finally {
      answerSpy.mockRestore();
      candidateSpy.mockRestore();
    }
  });
});

describe('a native start that completes after the ride gave up on it', () => {
  it('stops the microphone again when media.start() resolves after the step timeout and release grace', async () => {
    const h = createTwoPeerHarness({ seed: 51 });
    const realStart = h.host.media.start.bind(h.host.media);
    let finishStart: () => void = () => undefined;
    jest.spyOn(h.host.media, 'start').mockImplementation(
      (options) =>
        new Promise<void>((resolve) => {
          finishStart = () => resolve(realStart(options));
        }),
    );
    await h.host.start();
    await h.runUntil(() => h.host.snapshot().state === 'ended', { label: 'ended after the start timeout' });
    expect(h.host.snapshot().error?.code).toBe('media-failed');
    expect(h.host.media.stopCalls).toBe(1);

    // The native layer finally opens the microphone, long after the ride ended.
    finishStart();
    await h.settle();
    expect(h.host.media.startCalls).toBe(1);
    expect(h.host.media.stopCalls).toBe(2);
    expect(h.host.media.started).toBe(false);
    expect(h.clock.pendingTimers()).toBe(0);
  });

  it('stops the audio route again when audio.start() resolves after the step timeout and release grace', async () => {
    const h = createTwoPeerHarness({ seed: 52 });
    const realStart = h.host.audio.start.bind(h.host.audio);
    let finishStart: () => void = () => undefined;
    jest.spyOn(h.host.audio, 'start').mockImplementation(
      (options) =>
        new Promise((resolve) => {
          finishStart = () => resolve(realStart(options));
        }),
    );
    await h.host.start();
    await h.runUntil(() => h.host.snapshot().state === 'ended', { label: 'ended after the start timeout' });
    expect(h.host.snapshot().error?.code).toBe('audio-route-failed');
    expect(h.host.audio.stopCalls).toBe(1);

    finishStart();
    await h.settle();
    expect(h.host.audio.isRunning).toBe(false);
    expect(h.host.audio.stopCalls).toBe(2);
    expect(h.clock.pendingTimers()).toBe(0);
  });

  it('does not stop a second time when the start finished within the grace period', async () => {
    const h = createTwoPeerHarness({ seed: 53 });
    await h.host.start();
    await h.runUntil(() => h.host.service.running, { label: 'service running' });
    await h.host.controller.end();
    await h.settle();
    expect(h.host.media.stopCalls).toBe(1);
    expect(h.host.audio.stopCalls).toBe(1);
    expect(h.host.service.stopCalls).toBe(1);
  });
});

describe('microphone permission reported unavailable', () => {
  it('counts as granted: PermissionService documents unavailable as "not applicable here", not "denied"', async () => {
    const h = createTwoPeerHarness({ seed: 54 });
    h.host.permissions.set('microphone', 'unavailable');
    h.guest.permissions.set('microphone', 'unavailable');
    await connect(h);
    expect(h.host.permissions.requested).toEqual([]);
    await h.host.controller.end();
    await h.guest.controller.end();
  });

  it('a denied or blocked microphone is never treated like unavailable', async () => {
    for (const state of ['denied', 'blocked'] as const) {
      const h = createTwoPeerHarness({ seed: 55 });
      h.host.permissions.set('microphone', state).willAnswer('microphone', state);
      await h.host.start();
      await h.runUntil(() => h.host.snapshot().state === 'ended', { label: `ended (${state})` });
      expect(h.host.snapshot().error?.code).toBe('permission-denied');
      expect(h.host.audio.startCalls).toBe(0);
    }
  });
});
