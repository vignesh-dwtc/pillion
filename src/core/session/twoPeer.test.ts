import { createTwoPeerHarness, createFakeEstablish, type TwoPeerHarness } from './testing';

/**
 * The two-peer simulation: a real host controller and a real guest controller against each other over an
 * in-memory link and a fake media fabric, driven only by a ManualClock. No input is given after start().
 */

async function connect(h: TwoPeerHarness): Promise<void> {
  await h.startBoth();
  await h.runUntil(() => h.bothConnected(), { label: 'both connected' });
}

describe('two peers: first connection', () => {
  it('walks both sides through the documented states to connected', async () => {
    const h = createTwoPeerHarness();
    await connect(h);
    for (const rig of [h.host, h.guest]) {
      const states = rig.states();
      expect(states[0]).toBe('idle');
      expect(states[states.length - 1]).toBe('connected');
      expect(states).toEqual(
        expect.arrayContaining(['starting', 'linking', 'signaling', 'connecting', 'connected']),
      );
      expect(states.indexOf('starting')).toBeLessThan(states.indexOf('linking'));
      expect(states.indexOf('linking')).toBeLessThan(states.indexOf('signaling'));
      expect(states.indexOf('signaling')).toBeLessThan(states.indexOf('connecting'));
      expect(states.indexOf('connecting')).toBeLessThan(states.indexOf('connected'));
      expect(rig.snapshot().connectedAt).not.toBeNull();
      expect(rig.snapshot().error).toBeNull();
      expect(rig.service.running).toBe(true);
      expect(rig.audio.isRunning).toBe(true);
    }
    expect(h.host.snapshot().role).toBe('host');
    expect(h.guest.snapshot().role).toBe('guest');
    expect(h.host.snapshot().peer?.name).toBe('Pillion');
    expect(h.guest.snapshot().peer?.name).toBe('Rider');
    expect(h.host.audio.cues).toContain('connected');
    expect(h.guest.audio.cues).toContain('connected');
    await h.host.controller.end();
    await h.guest.controller.end();
  });

  it('works when the guest starts long before the host', async () => {
    const h = createTwoPeerHarness({ seed: 3 });
    await h.guest.start();
    await h.advance(20_000);
    expect(h.guest.snapshot().state).not.toBe('connected');
    expect(h.guest.snapshot().state).not.toBe('ended');
    await h.host.start();
    await h.runUntil(() => h.bothConnected(), { label: 'connect after late host' });
    await h.host.controller.end();
    await h.guest.controller.end();
  });

  it('connects over chunked, delayed, coalesced bytes', async () => {
    const h = createTwoPeerHarness({
      link: { latencyMs: 15, chunking: { mode: 'random', min: 1, max: 7, seed: 9 }, coalesce: true },
      media: { connectDelayMs: 40 },
    });
    await connect(h);
    await h.host.controller.end();
    await h.guest.controller.end();
  });
});

describe('two peers: recovery', () => {
  it('recovers both sides by itself after the link drops, and the generation increases', async () => {
    const h = createTwoPeerHarness();
    await connect(h);
    const before = { host: h.host.snapshot().generation, guest: h.guest.snapshot().generation };

    h.linkHub.dropLink('io-error');
    await h.runUntil(
      () => h.host.snapshot().state !== 'connected' || h.guest.snapshot().state !== 'connected',
      {
        label: 'drop noticed',
      },
    );
    await h.runUntil(() => h.bothConnected(), { label: 'recovered' });

    for (const [rig, was] of [
      [h.host, before.host],
      [h.guest, before.guest],
    ] as const) {
      expect(rig.snapshot().generation).toBeGreaterThan(was);
      expect(rig.snapshot().attempt).toBe(0);
      expect(rig.snapshot().error).toBeNull();
      expect(rig.states()).toContain('reconnecting');
      expect(rig.audio.cues).toEqual(expect.arrayContaining(['connected', 'reconnecting']));
      // The audio route and the service were kept across the outage, not restarted.
      expect(rig.audio.startCalls).toBe(1);
      expect(rig.service.startCalls).toBe(1);
    }
    await h.host.controller.end();
    await h.guest.controller.end();
  });

  it('alternates connected and reconnecting across many drops and never ends by itself', async () => {
    const h = createTwoPeerHarness({ seed: 5 });
    await connect(h);
    let generation = h.host.snapshot().generation;
    for (let i = 0; i < 6; i++) {
      h.linkHub.dropLink('network-lost');
      await h.runUntil(() => h.bothConnected() && h.host.snapshot().generation > generation, {
        label: `recovery ${i}`,
      });
      generation = h.host.snapshot().generation;
    }
    for (const rig of [h.host, h.guest]) {
      const states = rig.states();
      expect(states).not.toContain('ended');
      expect(states.filter((s) => s === 'reconnecting').length).toBeGreaterThanOrEqual(6);
      expect(states.filter((s) => s === 'connected').length).toBeGreaterThanOrEqual(7);
    }
    await h.host.controller.end();
    await h.guest.controller.end();
  });

  it('survives a long outage (network down for ten minutes) and reconnects when it returns', async () => {
    const h = createTwoPeerHarness({ seed: 11 });
    await connect(h);
    h.network.setUp(false);
    await h.advance(10 * 60_000);
    for (const rig of [h.host, h.guest]) {
      expect(rig.snapshot().state).toBe('reconnecting');
      expect(rig.snapshot().attempt).toBeGreaterThan(5);
      expect(rig.snapshot().error?.recoverable).toBe(true);
    }
    // Backoff caps at maxMs: attempts keep coming at a bounded pace (about one per 3s plus open timeouts).
    const opens = h.linkHub.openTimes.host;
    const gaps = opens
      .slice(-4)
      .map((t, i, all) => (i === 0 ? 0 : t - (all[i - 1] ?? t)))
      .slice(1);
    for (const gap of gaps) expect(gap).toBeLessThanOrEqual(20_000);

    h.network.setUp(true);
    await h.runUntil(() => h.bothConnected(), { label: 'recovered after outage' });
    expect(h.host.snapshot().attempt).toBe(0);
    await h.host.controller.end();
    await h.guest.controller.end();
  });

  it('notices a half-open link (silent black hole) through heartbeats alone and recovers', async () => {
    const h = createTwoPeerHarness({ seed: 2, media: { failAfterMs: null } });
    await connect(h);
    h.network.setBlackhole(true);
    await h.runUntil(
      () => h.host.snapshot().state === 'reconnecting' && h.guest.snapshot().state === 'reconnecting',
      {
        label: 'heartbeat timeout on both sides',
        maxMs: 30_000,
      },
    );
    h.network.setBlackhole(false);
    await h.runUntil(() => h.bothConnected(), { label: 'recovered from black hole' });
    await h.host.controller.end();
    await h.guest.controller.end();
  });

  it('recovers when media fails while the link stays up', async () => {
    const h = createTwoPeerHarness({ seed: 4 });
    await connect(h);
    const generation = h.host.snapshot().generation;
    h.host.media.currentSession?.forceState('failed');
    await h.runUntil(() => h.bothConnected() && h.host.snapshot().generation > generation, {
      label: 'recovered from media failure',
    });
    await h.host.controller.end();
    await h.guest.controller.end();
  });

  it('keeps retrying while link opens fail, and connects when they stop failing', async () => {
    const h = createTwoPeerHarness({ seed: 6 });
    h.linkHub.failOpens(
      'guest',
      Object.assign(new Error('no route'), { name: 'LinkError', code: 'unavailable' }),
    );
    await h.startBoth();
    await h.advance(60_000);
    expect(h.guest.snapshot().state).not.toBe('ended');
    expect(h.guest.snapshot().error?.code).toBe('link-unavailable');
    expect(h.guest.snapshot().attempt).toBeGreaterThan(3);
    h.linkHub.failOpens('guest', null);
    await h.runUntil(() => h.bothConnected(), { label: 'connected once opens work' });
    await h.host.controller.end();
    await h.guest.controller.end();
  });
});

describe('two peers: backoff schedule', () => {
  it('is bounded by the configured maximum and identical for the same seed', async () => {
    const run = async (): Promise<number[]> => {
      const h = createTwoPeerHarness({ seed: 8, link: { whenDown: 'unavailable' } });
      await connect(h);
      h.network.setUp(false);
      await h.advance(60_000);
      const times = [...h.linkHub.openTimes.guest];
      await h.host.controller.end();
      await h.guest.controller.end();
      return times;
    };
    const a = await run();
    const b = await run();
    expect(a).toEqual(b);
    const gaps = a.slice(1).map((t, i) => t - (a[i] ?? 0));
    expect(gaps.length).toBeGreaterThan(5);
    // Jitter 0.2 on a 3000ms cap, plus small scheduling slack.
    for (const gap of gaps.slice(-5)) {
      expect(gap).toBeLessThanOrEqual(3_600 + 100);
      expect(gap).toBeGreaterThanOrEqual(2_400 - 100);
    }
  });
});

describe('two peers: mute and peer state', () => {
  it('propagates mute to the partner and back, and keeps it across a reconnect', async () => {
    const h = createTwoPeerHarness();
    await connect(h);
    h.host.controller.setMuted(true);
    expect(h.host.snapshot().muted).toBe(true);
    await h.runUntil(() => h.guest.snapshot().peer?.muted === true, { label: 'mute reaches guest' });
    expect(h.guest.snapshot().muted).toBe(false);

    h.guest.controller.setMuted(true);
    await h.runUntil(() => h.host.snapshot().peer?.muted === true, { label: 'mute reaches host' });
    h.host.controller.setMuted(false);
    await h.runUntil(() => h.guest.snapshot().peer?.muted === false, { label: 'unmute reaches guest' });

    const generation = h.host.snapshot().generation;
    h.linkHub.dropLink();
    await h.runUntil(() => h.bothConnected() && h.host.snapshot().generation > generation, {
      label: 'recovered',
    });
    expect(h.guest.snapshot().muted).toBe(true);
    expect(h.host.snapshot().peer?.muted).toBe(true);
    await h.host.controller.end();
    await h.guest.controller.end();
  });

  it('reports a partner whose headset disconnects', async () => {
    const h = createTwoPeerHarness();
    await connect(h);
    h.guest.audio.setHeadsetConnected(false);
    await h.runUntil(() => h.host.snapshot().peer?.headsetConnected === false, {
      label: 'headset state reaches host',
    });
    expect(h.guest.snapshot().local.headsetConnected).toBe(false);
    await h.host.controller.end();
    await h.guest.controller.end();
  });
});

describe('two peers: ending', () => {
  it('end() on the host ends the guest with partner-ended and releases everything on both', async () => {
    const h = createTwoPeerHarness();
    await connect(h);
    await h.host.controller.end();
    await h.runUntil(() => h.guest.snapshot().state === 'ended', { label: 'guest ended' });
    expect(h.host.snapshot().state).toBe('ended');
    expect(h.host.snapshot().error).toBeNull();
    expect(h.guest.snapshot().error?.code).toBe('partner-ended');
    expect(h.guest.snapshot().error?.recoverable).toBe(false);
    for (const rig of [h.host, h.guest]) {
      expect(rig.service.running).toBe(false);
      expect(rig.audio.isRunning).toBe(false);
      expect(rig.service.stopCalls).toBeGreaterThanOrEqual(1);
      expect(rig.audio.stopCalls).toBeGreaterThanOrEqual(1);
      expect(rig.media.openSessions).toBe(0);
    }
    // Nothing keeps running: advancing time changes nothing and opens nothing.
    const opens = h.linkHub.openCount('host') + h.linkHub.openCount('guest');
    await h.advance(60_000);
    expect(h.linkHub.openCount('host') + h.linkHub.openCount('guest')).toBe(opens);
    expect(h.host.snapshot().state).toBe('ended');
    expect(h.guest.snapshot().state).toBe('ended');
  });

  it('end() on the guest ends the host the same way', async () => {
    const h = createTwoPeerHarness();
    await connect(h);
    await h.guest.controller.end();
    await h.runUntil(() => h.host.snapshot().state === 'ended', { label: 'host ended' });
    expect(h.host.snapshot().error?.code).toBe('partner-ended');
    expect(h.guest.snapshot().error).toBeNull();
    expect(h.host.service.running).toBe(false);
    expect(h.host.audio.isRunning).toBe(false);
  });

  it('end() is idempotent, also when called concurrently', async () => {
    const h = createTwoPeerHarness();
    await connect(h);
    await Promise.all([h.host.controller.end(), h.host.controller.end()]);
    await h.host.controller.end();
    expect(h.host.service.stopCalls).toBe(1);
    expect(h.host.audio.stopCalls).toBe(1);
    expect(h.host.snapshot().state).toBe('ended');
    await h.guest.controller.end();
  });

  it('end() during an outage releases everything and the partner keeps trying until it ends too', async () => {
    const h = createTwoPeerHarness();
    await connect(h);
    h.network.setUp(false);
    await h.runUntil(() => h.host.snapshot().state === 'reconnecting', { label: 'host reconnecting' });
    await h.host.controller.end();
    expect(h.host.snapshot().state).toBe('ended');
    expect(h.host.audio.isRunning).toBe(false);
    expect(h.host.service.running).toBe(false);
    await h.advance(30_000);
    expect(h.guest.snapshot().state).toBe('reconnecting');
    await h.guest.controller.end();
    expect(h.guest.audio.isRunning).toBe(false);
  });

  it('end() before the partner ever shows up is clean', async () => {
    const h = createTwoPeerHarness();
    await h.host.start();
    await h.advance(5_000);
    await h.host.controller.end();
    expect(h.host.snapshot().state).toBe('ended');
    expect(h.host.audio.isRunning).toBe(false);
    expect(h.host.service.running).toBe(false);
  });
});

describe('two peers: failures', () => {
  it('surfaces auth-failed on both sides when the secrets differ, and keeps retrying', async () => {
    const h = createTwoPeerHarness({ hostSecretByte: 1, guestSecretByte: 2 });
    await h.startBoth();
    await h.runUntil(
      () =>
        h.host.snapshot().error?.code === 'auth-failed' || h.guest.snapshot().error?.code === 'auth-failed',
      {
        label: 'auth failure surfaced',
      },
    );
    await h.advance(30_000);
    const codes = [h.host.snapshot().error?.code, h.guest.snapshot().error?.code];
    expect(codes).toContain('auth-failed');
    for (const rig of [h.host, h.guest]) {
      expect(rig.snapshot().state).not.toBe('connected');
      expect(rig.snapshot().state).not.toBe('ended');
    }
    // No secret or passphrase anywhere in the logs.
    for (const rig of [h.host, h.guest]) {
      expect(rig.logger.text()).not.toContain(rig.pairing.secret);
      expect(rig.logger.text()).not.toContain(rig.pairing.wifiDirect?.passphrase ?? 'x-none');
    }
    await h.host.controller.end();
    await h.guest.controller.end();
  });

  it('reports version-mismatch when the partner speaks another protocol version', async () => {
    const h = createTwoPeerHarness({ guestEstablish: createFakeEstablish({ version: 2 }) });
    await h.startBoth();
    await h.runUntil(
      () =>
        h.host.snapshot().error?.code === 'version-mismatch' ||
        h.guest.snapshot().error?.code === 'version-mismatch',
      { label: 'version mismatch surfaced' },
    );
    await h.host.controller.end();
    await h.guest.controller.end();
  });

  it('ends with no-headset when the earbuds are missing, and releases what it acquired', async () => {
    const h = createTwoPeerHarness({ guestHeadset: false });
    await h.startBoth();
    await h.runUntil(() => h.guest.snapshot().state === 'ended', {
      label: 'guest ended for missing headset',
    });
    expect(h.guest.snapshot().error?.code).toBe('no-headset');
    expect(h.guest.snapshot().error?.recoverable).toBe(false);
    expect(h.guest.audio.isRunning).toBe(false);
    expect(h.guest.service.running).toBe(false);
    await h.host.controller.end();
  });

  it('allowNoHeadset lets a phone without earbuds ride on the fallback device', async () => {
    const h = createTwoPeerHarness({ guestHeadset: false });
    await h.host.start();
    await h.guest.start({ allowNoHeadset: true });
    await h.runUntil(() => h.bothConnected(), { label: 'connected with fallback device' });
    await h.host.controller.end();
    await h.guest.controller.end();
  });

  it('ends with permission-denied when the microphone is denied, before touching audio or the service', async () => {
    const h = createTwoPeerHarness();
    h.guest.permissions.set('microphone', 'denied').willAnswer('microphone', 'denied');
    await h.startBoth();
    await h.runUntil(() => h.guest.snapshot().state === 'ended', { label: 'guest ended for permission' });
    expect(h.guest.snapshot().error?.code).toBe('permission-denied');
    expect(h.guest.snapshot().error?.recoverable).toBe(false);
    expect(h.guest.audio.startCalls).toBe(0);
    expect(h.guest.service.startCalls).toBe(0);
    await h.host.controller.end();
  });

  it('ends with permission-denied when the microphone is blocked in settings', async () => {
    const h = createTwoPeerHarness();
    h.host.permissions.set('microphone', 'blocked');
    await h.host.start();
    await h.runUntil(() => h.host.snapshot().state === 'ended', {
      label: 'host ended for blocked permission',
    });
    expect(h.host.snapshot().error?.code).toBe('permission-denied');
    expect(h.host.snapshot().error?.message).toMatch(/blocked/);
  });

  it('ends with media-failed when the microphone cannot be opened', async () => {
    const h = createTwoPeerHarness();
    h.host.media.failStart();
    await h.host.start();
    await h.runUntil(() => h.host.snapshot().state === 'ended', { label: 'host ended for capture failure' });
    expect(h.host.snapshot().error?.code).toBe('media-failed');
    expect(h.host.audio.isRunning).toBe(false);
    expect(h.host.service.running).toBe(false);
  });

  it('ends with service-failed when the foreground service refuses, releasing the audio route', async () => {
    const h = createTwoPeerHarness();
    h.host.service.failStart();
    await h.host.start();
    await h.runUntil(() => h.host.snapshot().state === 'ended', { label: 'host ended for service failure' });
    expect(h.host.snapshot().error?.code).toBe('service-failed');
    expect(h.host.audio.isRunning).toBe(false);
  });

  it('ends with audio-route-failed when the route cannot start', async () => {
    const h = createTwoPeerHarness();
    h.host.audio.failStart();
    await h.host.start();
    await h.runUntil(() => h.host.snapshot().state === 'ended', { label: 'host ended for route failure' });
    expect(h.host.snapshot().error?.code).toBe('audio-route-failed');
    expect(h.host.service.running).toBe(false);
  });

  it('a failing or hanging cue player never breaks or delays the ride', async () => {
    for (const mode of ['throw', 'reject', 'hang'] as const) {
      const h = createTwoPeerHarness({ seed: 21 });
      h.host.audio.setCueFailure(mode);
      h.guest.audio.setCueFailure(mode);
      await connect(h);
      h.linkHub.dropLink();
      await h.runUntil(() => h.host.snapshot().state === 'reconnecting', { label: `reconnecting (${mode})` });
      await h.runUntil(() => h.bothConnected(), { label: `recovered (${mode})` });
      // A hanging cue is bounded by the shutdown's cue grace period, which runs on the injected clock.
      const ending = Promise.all([h.host.controller.end(), h.guest.controller.end()]);
      await h.advance(10_000);
      await ending;
      expect(h.host.snapshot().state).toBe('ended');
      expect(h.guest.snapshot().state).toBe('ended');
    }
  });
});

describe('two peers: determinism', () => {
  it('plays the same scenario identically twice', async () => {
    const play = async (): Promise<string> => {
      const h = createTwoPeerHarness({
        seed: 13,
        link: { latencyMs: 7, chunking: { mode: 'fixed', size: 5 } },
      });
      await connect(h);
      h.linkHub.dropLink();
      await h.runUntil(() => h.host.snapshot().state === 'reconnecting', { label: 'reconnecting' });
      await h.runUntil(() => h.bothConnected(), { label: 'recovered' });
      const out = JSON.stringify([h.host.history, h.guest.history, h.linkHub.openTimes, h.clock.now()]);
      await h.host.controller.end();
      await h.guest.controller.end();
      return out;
    };
    expect(await play()).toBe(await play());
  });
});
