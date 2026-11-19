import {
  createTwoPeerHarness,
  tapEstablish,
  establishFakeSecureChannel,
  makeTestPairing,
  type WireRecord,
} from './testing';
import type { Clock } from '../common/types';
import type { SessionSnapshot } from './types';
import type { SessionMessage } from '../protocol/messages';

const clockStub = { now: () => 0 } as unknown as Clock;

describe('createSessionController: single-controller behaviour', () => {
  it('starts idle with no pairing information', () => {
    const h = createTwoPeerHarness();
    const s = h.host.snapshot();
    expect(s.state).toBe('idle');
    expect(s.role).toBeNull();
    expect(s.generation).toBe(0);
    expect(s.error).toBeNull();
    expect(s.muted).toBe(false);
  });

  it('rejects a second start() and a malformed pairing, as programmer errors', async () => {
    const h = createTwoPeerHarness();
    await expect(h.host.start({ pairing: { ...h.host.pairing, secret: 'short' } })).rejects.toThrow(
      TypeError,
    );
    await expect(h.host.start({ pairing: { ...h.host.pairing, pairId: '!!' } })).rejects.toThrow(TypeError);
    await expect(h.host.start({ pairing: { ...h.host.pairing, role: 'x' as never } })).rejects.toThrow(
      TypeError,
    );
    await h.host.start();
    await expect(h.host.start()).rejects.toThrow();
    await h.host.controller.end();
  });

  it('start() resolves before anything is connected', async () => {
    const h = createTwoPeerHarness();
    await h.host.start();
    expect(h.host.snapshot().state).not.toBe('connected');
    await h.host.controller.end();
  });

  it('notifies subscribers on change, not on subscribe, and stops after unsubscribe', async () => {
    const h = createTwoPeerHarness();
    const seen: SessionSnapshot[] = [];
    const off = h.host.controller.subscribe((s) => seen.push(s));
    expect(seen).toHaveLength(0);
    await h.host.start();
    await h.settle();
    expect(seen.length).toBeGreaterThan(0);
    off();
    const count = seen.length;
    await h.host.controller.end();
    expect(seen.length).toBe(count);
  });

  it('a throwing subscriber does not break the ride or other subscribers', async () => {
    const h = createTwoPeerHarness();
    let calls = 0;
    h.host.controller.subscribe(() => {
      throw new Error('listener bug');
    });
    h.host.controller.subscribe(() => {
      calls += 1;
    });
    await h.startBoth();
    await h.runUntil(() => h.bothConnected(), { label: 'connected despite bad listener' });
    expect(calls).toBeGreaterThan(0);
    await h.host.controller.end();
    await h.guest.controller.end();
  });

  it('setMuted before connect is applied and sent once connected; after end it is ignored', async () => {
    const h = createTwoPeerHarness();
    await h.startBoth();
    h.guest.controller.setMuted(true);
    await h.runUntil(() => h.bothConnected(), { label: 'connected' });
    await h.runUntil(() => h.host.snapshot().peer?.muted === true, { label: 'early mute reaches host' });
    await h.guest.controller.end();
    h.guest.controller.setMuted(false);
    expect(h.guest.snapshot().muted).toBe(true);
    await h.host.controller.end();
  });

  it('the notification buttons mute and end the ride', async () => {
    const h = createTwoPeerHarness();
    await h.startBoth();
    await h.runUntil(() => h.bothConnected(), { label: 'connected' });
    h.host.service.emitAction('toggle-mute');
    expect(h.host.snapshot().muted).toBe(true);
    await h.runUntil(() => h.host.service.lastUpdate?.muted === true, { label: 'notification shows mute' });
    expect(h.host.service.lastUpdate?.connected).toBe(true);
    h.host.service.emitAction('end');
    await h.runUntil(() => h.host.snapshot().state === 'ended', { label: 'ended from notification' });
    await h.runUntil(() => h.guest.snapshot().state === 'ended', { label: 'partner ended' });
  });

  it('ignores stale-generation signaling from an authenticated partner', async () => {
    const records: WireRecord[] = [];
    const rewrite = (from: 'host' | 'guest', m: SessionMessage): SessionMessage[] | undefined => {
      if (from === 'host' && m.type === 'ice') {
        // A stale duplicate (generation 0 never exists) in front of the real one.
        return [{ ...m, generation: 0 }, m];
      }
      return undefined;
    };
    const h = createTwoPeerHarness({
      establish: tapEstablish(establishFakeSecureChannel, { clock: clockStub, records, rewrite }),
    });
    await h.startBoth();
    await h.runUntil(() => h.bothConnected(), { label: 'connected despite stale candidates' });
    await h.host.controller.end();
    await h.guest.controller.end();
  });

  it('survives garbage peer-state values', async () => {
    const rewrite = (from: 'host' | 'guest', m: SessionMessage): SessionMessage[] | undefined => {
      if (from === 'guest' && m.type === 'peer-state') {
        return [{ ...m, name: 'x'.repeat(5000), batteryPct: 900 } as SessionMessage];
      }
      return undefined;
    };
    const h = createTwoPeerHarness({
      establish: tapEstablish(establishFakeSecureChannel, { clock: clockStub, records: [], rewrite }),
    });
    await h.startBoth();
    await h.runUntil(() => h.bothConnected(), { label: 'connected with odd peer-state' });
    const peer = h.host.snapshot().peer;
    expect(peer?.name.length).toBeLessThanOrEqual(64);
    expect(peer?.batteryPct === null || (peer?.batteryPct ?? 0) <= 100).toBe(true);
    await h.host.controller.end();
    await h.guest.controller.end();
  });

  it('exposes media stats while connected and null after end', async () => {
    const h = createTwoPeerHarness();
    await h.startBoth();
    await h.runUntil(() => h.bothConnected(), { label: 'connected' });
    expect(await h.host.controller.getMediaStats()).not.toBeNull();
    await h.host.controller.end();
    expect(await h.host.controller.getMediaStats()).toBeNull();
    await h.guest.controller.end();
  });

  it('makeTestPairing produces distinct records for different bytes', () => {
    expect(makeTestPairing('host', { secretByte: 1 }).secret).not.toBe(
      makeTestPairing('host', { secretByte: 2 }).secret,
    );
  });
});
