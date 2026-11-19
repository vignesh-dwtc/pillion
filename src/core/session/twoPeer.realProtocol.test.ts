import type { Clock } from '../common/types';
import { establishSecureChannel } from '../protocol/establish';
import {
  createTwoPeerHarness,
  tapEstablish,
  wireTypes,
  type WireRecord,
  type TwoPeerHarness,
} from './testing';

/**
 * The same two-peer simulation, but with the real handshake and real framing from core/protocol instead of the
 * stand-in, over a link that cuts every write into odd-sized chunks and delays it.
 */

async function connect(h: TwoPeerHarness): Promise<void> {
  await h.startBoth();
  await h.runUntil(() => h.bothConnected(), { label: 'both connected (real protocol)' });
}

async function endBoth(h: TwoPeerHarness): Promise<void> {
  await h.host.controller.end();
  await h.guest.controller.end();
}

describe('two peers with the real secure channel', () => {
  it('connects, syncs mute and recovers from a mid-call drop', async () => {
    const h = createTwoPeerHarness({
      seed: 17,
      establish: establishSecureChannel,
      link: { latencyMs: 9, chunking: { mode: 'random', min: 1, max: 11, seed: 3 } },
    });
    await connect(h);
    expect(h.host.snapshot().peer?.name).toBe('Pillion');
    expect(h.guest.snapshot().peer?.name).toBe('Rider');

    h.guest.controller.setMuted(true);
    await h.runUntil(() => h.host.snapshot().peer?.muted === true, { label: 'mute over the real channel' });

    const generation = h.host.snapshot().generation;
    h.linkHub.dropLink('io-error');
    await h.runUntil(() => h.host.snapshot().state === 'reconnecting', { label: 'drop noticed' });
    await h.runUntil(() => h.bothConnected() && h.host.snapshot().generation > generation, {
      label: 'recovered',
    });
    expect(h.host.snapshot().peer?.muted).toBe(true);
    expect(h.guest.snapshot().muted).toBe(true);
    await endBoth(h);
  });

  it('recovers from several drops, including one during the handshake', async () => {
    const h = createTwoPeerHarness({
      seed: 23,
      establish: establishSecureChannel,
      link: { latencyMs: 20, chunking: { mode: 'fixed', size: 3 } },
    });
    await connect(h);
    for (let i = 0; i < 3; i++) {
      h.linkHub.dropLink();
      // Cut again a little later: the second cut lands inside the next attempt's handshake or media exchange.
      await h.advance(700 + i * 150);
      h.linkHub.dropLink('timeout');
      await h.runUntil(() => h.bothConnected(), { label: `recovered after double drop ${i}` });
    }
    expect(h.host.states()).not.toContain('ended');
    await endBoth(h);
  });

  it('reports auth-failed when the secrets differ, and keeps the secret out of the logs', async () => {
    const h = createTwoPeerHarness({
      establish: establishSecureChannel,
      hostSecretByte: 1,
      guestSecretByte: 2,
    });
    await h.startBoth();
    await h.runUntil(
      () =>
        h.host.snapshot().error?.code === 'auth-failed' || h.guest.snapshot().error?.code === 'auth-failed',
      { label: 'auth-failed (real protocol)', maxMs: 60_000 },
    );
    for (const rig of [h.host, h.guest]) {
      expect(rig.snapshot().state).not.toBe('connected');
      expect(rig.logger.text()).not.toContain(rig.pairing.secret);
    }
    await endBoth(h);
  });

  it('exchanges signaling in a sane order over the real channel', async () => {
    const records: WireRecord[] = [];
    const clock = { now: () => 0 } as unknown as Clock;
    const h = createTwoPeerHarness({
      establish: tapEstablish(establishSecureChannel, { records, clock }),
      link: { chunking: { mode: 'fixed', size: 4 } },
    });
    await connect(h);
    const fromHost = wireTypes(records, 'host');
    const fromGuest = wireTypes(records, 'guest');
    expect(fromHost).toContain('peer-state');
    expect(fromGuest).toContain('peer-state');
    const sdps = records.filter((r) => r.message.type === 'sdp');
    const offers = sdps.filter((r) => r.message.type === 'sdp' && r.message.kind === 'offer');
    const answers = sdps.filter((r) => r.message.type === 'sdp' && r.message.kind === 'answer');
    expect(offers).toHaveLength(1);
    expect(answers).toHaveLength(1);
    // The answer comes from the other side than the offer, and candidates only follow the first SDP message.
    expect(answers[0]?.from).not.toBe(offers[0]?.from);
    const firstSdp = records.findIndex((r) => r.message.type === 'sdp');
    const firstIce = records.findIndex((r) => r.message.type === 'ice');
    expect(firstSdp).toBeGreaterThanOrEqual(0);
    expect(firstIce).toBeGreaterThan(firstSdp);
    await endBoth(h);
  });

  it('bye from one side ends the other with partner-ended', async () => {
    const h = createTwoPeerHarness({
      establish: establishSecureChannel,
      link: { chunking: { mode: 'fixed', size: 5 } },
    });
    await connect(h);
    await h.host.controller.end();
    await h.runUntil(() => h.guest.snapshot().state === 'ended', { label: 'guest ended by bye' });
    expect(h.guest.snapshot().error?.code).toBe('partner-ended');
    await h.guest.controller.end();
  });
});
