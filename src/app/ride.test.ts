import type { PairingRecord, PairingRepository } from '../core/pairing/types';
import { createSessionController } from '../core/session';
import {
  FakeAudioRoute,
  FakeMediaEngine,
  FakeMediaFabric,
  FakeNetwork,
  FakePermissionService,
  FakeRideService,
  ManualClock,
  MemoryLogger,
  TEST_PASSPHRASE,
  createInMemoryLinkPair,
  createSeededCrypto,
  establishFakeSecureChannel,
  makeTestPairing,
} from '../core/session/testing';
import type { SessionController, SessionDeps } from '../core/session/types';
import { DEFAULT_AUDIO_TUNABLES, type AudioTunables } from '../platform/audio/AudioTunables';
import type { LinkTransport } from '../platform/link/LinkTransport';

import { createRideRuntime, type RideRuntime } from './ride';

class MemoryPairings implements PairingRepository {
  readonly saved: PairingRecord[] = [];
  constructor(private readonly records: Map<string, PairingRecord>) {}
  list() {
    return Promise.resolve([...this.records.values()]);
  }
  get(pairId: string) {
    return Promise.resolve(this.records.get(pairId) ?? null);
  }
  save(record: PairingRecord) {
    this.records.set(record.pairId, record);
    this.saved.push(record);
    return Promise.resolve();
  }
  remove(pairId: string) {
    this.records.delete(pairId);
    return Promise.resolve();
  }
}

interface Side {
  runtime: RideRuntime;
  audio: FakeAudioRoute;
  service: FakeRideService;
  media: FakeMediaEngine;
  pairings: MemoryPairings;
  record: PairingRecord;
  controllers: SessionController[];
  pairingsChanged: number;
}

function setup() {
  const clock = new ManualClock(1_000_000);
  const network = new FakeNetwork();
  const links = createInMemoryLinkPair({ clock, network });
  const fabric = new FakeMediaFabric({ clock, network });

  const side = (role: 'host' | 'guest', seed: number): Side => {
    const record = makeTestPairing(role);
    const pairings = new MemoryPairings(new Map([[record.pairId, record]]));
    const media = new FakeMediaEngine(fabric, role);
    const audio = new FakeAudioRoute({ headsetConnected: true });
    const service = new FakeRideService();
    const result: Side = {
      record,
      pairings,
      media,
      audio,
      service,
      controllers: [],
      pairingsChanged: 0,
      runtime: undefined as unknown as RideRuntime,
    };
    result.runtime = createRideRuntime({
      createController: (deps: SessionDeps) => {
        const controller = createSessionController({
          ...deps,
          establishSecureChannel: establishFakeSecureChannel,
        });
        result.controllers.push(controller);
        return controller;
      },
      createLink: (): LinkTransport => (role === 'host' ? links.host : links.guest),
      createMedia: () => media,
      audio,
      service,
      permissions: new FakePermissionService(),
      crypto: createSeededCrypto(seed),
      clock,
      logger: new MemoryLogger(clock),
      pairings,
      getTunables: () => DEFAULT_AUDIO_TUNABLES,
      onPairingsChanged: () => {
        result.pairingsChanged += 1;
      },
    });
    return result;
  };

  const host = side('host', 2);
  const guest = side('guest', 3);

  const runUntil = async (predicate: () => boolean, maxMs = 60_000) => {
    let waited = 0;
    await clock.settle();
    while (!predicate()) {
      if (waited >= maxMs) throw new Error(`condition not met within ${maxMs} ms`);
      await clock.advance(100);
      waited += 100;
    }
  };

  const startBoth = async () => {
    await host.runtime.start({ pairId: host.record.pairId, deviceName: 'Rider', allowNoHeadset: false });
    await guest.runtime.start({ pairId: guest.record.pairId, deviceName: 'Pillion', allowNoHeadset: false });
  };

  const state = (s: Side) => s.runtime.store.getState().snapshot.state;
  return { clock, host, guest, links, runUntil, startBoth, state };
}

describe('ride runtime over the real session controller (fakes below it)', () => {
  it('mirrors the live snapshot, samples stats and learns the partner name', async () => {
    const t = setup();
    expect(t.state(t.host)).toBe('idle');
    await t.startBoth();
    expect(t.host.runtime.isActive()).toBe(true);
    await t.runUntil(() => t.state(t.host) === 'connected' && t.state(t.guest) === 'connected');

    const hostState = t.host.runtime.store.getState();
    expect(hostState.linkKind).toBe('memory');
    expect(hostState.snapshot.connectedAt).not.toBeNull();
    await t.runUntil(() => t.host.runtime.store.getState().snapshot.peer?.name === 'Pillion');

    // The host learns the guest's name on the first ride and stores it.
    await t.runUntil(() => t.host.pairings.saved.length > 0);
    expect(t.host.pairings.saved[0]?.partnerName).toBe('Pillion');
    expect(t.host.pairingsChanged).toBeGreaterThan(0);
    // The guest already had a null name in the fixture, so it learns "Rider".
    await t.runUntil(() => t.guest.pairings.saved.some((r) => r.partnerName === 'Rider'));

    // One-second stats samples arrive while connected.
    await t.runUntil(() => t.host.runtime.store.getState().stats !== null);
    expect(t.host.runtime.store.getState().stats?.connectionState).toBe('connected');
  });

  it('keeps the ride clock through a reconnect', async () => {
    const t = setup();
    await t.startBoth();
    await t.runUntil(() => t.state(t.host) === 'connected' && t.state(t.guest) === 'connected');
    const startedAt = t.host.runtime.store.getState().rideStartedAt;
    expect(startedAt).not.toBeNull();
    await t.clock.advance(5_000);
    t.links.hub.dropLink();
    await t.runUntil(() => t.state(t.host) === 'reconnecting');
    expect(t.host.runtime.store.getState().snapshot.connectedAt).toBeNull();
    expect(t.host.runtime.store.getState().rideStartedAt).toBe(startedAt);
    await t.runUntil(() => t.state(t.host) === 'connected');
    expect(t.host.runtime.store.getState().rideStartedAt).toBe(startedAt);
  });

  it('drives mute through the controller and the partner sees it', async () => {
    const t = setup();
    await t.startBoth();
    await t.runUntil(() => t.state(t.host) === 'connected' && t.state(t.guest) === 'connected');
    t.guest.runtime.setMuted(true);
    await t.runUntil(() => t.guest.runtime.store.getState().snapshot.muted);
    await t.runUntil(() => t.host.runtime.store.getState().snapshot.peer?.muted === true);
  });

  it('pushes edited tunables to the running media engine only', async () => {
    const t = setup();
    const spy = jest.spyOn(t.host.media, 'setTunables');
    const edited: AudioTunables = { ...DEFAULT_AUDIO_TUNABLES, opusBitrateBps: 32_000 };
    t.host.runtime.applyTunables(edited);
    expect(spy).not.toHaveBeenCalled();
    await t.startBoth();
    t.host.runtime.applyTunables(edited);
    expect(spy).toHaveBeenCalledWith(edited);
  });

  it('a notification End press ends the ride and the runtime goes inactive', async () => {
    const t = setup();
    await t.startBoth();
    await t.runUntil(() => t.state(t.host) === 'connected' && t.state(t.guest) === 'connected');
    t.host.service.emitAction('end');
    await t.runUntil(() => t.state(t.host) === 'ended');
    expect(t.host.runtime.isActive()).toBe(false);
    // The partner is told (bye) and ends too.
    await t.runUntil(() => t.state(t.guest) === 'ended');
  });

  it('end() from the ride screen ends the ride; a second start while active is ignored', async () => {
    const t = setup();
    await t.startBoth();
    await t.host.runtime.start({ pairId: t.host.record.pairId, deviceName: 'Rider', allowNoHeadset: false });
    expect(t.host.controllers).toHaveLength(1);
    const ending = t.host.runtime.end();
    await t.runUntil(() => t.state(t.host) === 'ended');
    await ending;
    expect(t.host.runtime.isActive()).toBe(false);
  });

  it('exposes the secret and passphrase only to the redactor, after a ride started', async () => {
    const t = setup();
    expect(t.host.runtime.sensitiveValues()).toEqual([]);
    await t.startBoth();
    expect(t.host.runtime.sensitiveValues()).toEqual([t.host.record.secret, TEST_PASSPHRASE]);
  });

  it('refuses to start without a stored pairing, and while the loopback test owns the microphone', async () => {
    const t = setup();
    await t.host.runtime.start({ pairId: 'missing', deviceName: 'Rider', allowNoHeadset: false });
    expect(t.host.runtime.store.getState().startProblem).toBe('no-pairing');
    expect(t.host.controllers).toHaveLength(0);

    t.host.runtime.setMicrophoneBusy(true);
    await t.host.runtime.start({ pairId: t.host.record.pairId, deviceName: 'Rider', allowNoHeadset: false });
    expect(t.host.runtime.store.getState().startProblem).toBe('busy-loopback');
    expect(t.host.controllers).toHaveLength(0);
    t.host.runtime.setMicrophoneBusy(false);
    expect(t.host.runtime.store.getState().startProblem).toBeNull();
  });

  it('follows the audio route before any ride (Home shows the headset)', async () => {
    const t = setup();
    await t.clock.settle();
    expect(t.host.runtime.store.getState().audio).not.toBeNull();
    t.host.audio.setHeadsetConnected(false);
    // The fake only emits while started; the screens re-read on foreground (refreshAudio).
    await t.host.runtime.refreshAudio();
    expect(t.host.runtime.store.getState().audio?.headsetConnected).toBe(false);
  });
});
