import { createStore, type StoreApi } from 'zustand/vanilla';

import type { Clock, Logger, Unsubscribe } from '../core/common/types';
import { createStatsPoller, type StatsSample } from '../core/diagnostics';
import type { PairingRecord, PairingRepository } from '../core/pairing/types';
import type { CryptoProvider } from '../core/protocol/crypto';
import type { SessionController, SessionDeps, SessionSnapshot } from '../core/session/types';
import type { AudioRoute, AudioRouteState } from '../platform/audio/AudioRoute';
import type { AudioTunables } from '../platform/audio/AudioTunables';
import type { LinkKind, LinkNetworkInterface, LinkTransport } from '../platform/link/LinkTransport';
import type { MediaEngine, MediaStats } from '../platform/media/MediaEngine';
import type { PermissionService } from '../platform/permissions/PermissionService';
import type { BatteryInfo, RideService } from '../platform/service/RideService';

/**
 * The live ride, as the screens see it. One `RideRuntime` per app; it creates a fresh `SessionController` (and a fresh
 * link transport and media engine) for every ride, because a controller runs exactly one ride and disposes its
 * transport when it ends. The runtime never makes a state transition of its own: it starts, mutes and ends the
 * controller and mirrors what the controller publishes (snapshot) plus the live media stats (sampled once a second)
 * and the audio route, into a Zustand store the hooks read.
 *
 * It also does the two things the controller has no port for:
 *  - the partner's name learned in `peer-state` is written back to the stored PairingRecord (the host only learns
 *    it on the first ride), and
 *  - audio tunables edited on the debug screen are pushed to the running media engine (`applyTunables`).
 *
 * Pure TypeScript with injected factories, so Jest drives it with fakes. Never logs a PairingRecord: the secret and the
 * Wi-Fi passphrase are only handed to the controller, and exposed to the ring log's redactor via `sensitiveValues()`.
 */

export const IDLE_SNAPSHOT: SessionSnapshot = {
  state: 'idle',
  role: null,
  pairId: null,
  muted: false,
  local: { headsetConnected: false, interruption: 'none', batteryPct: null },
  peer: null,
  transport: null,
  generation: 0,
  attempt: 0,
  connectedAt: null,
  error: null,
};

/** Why `start()` refused before a controller existed (the controller reports everything after that). */
export type RideStartProblem = 'no-pairing' | 'storage' | 'busy-loopback';

export interface RideState {
  snapshot: SessionSnapshot;
  /** Transport kind of the ride's link (known before the controller reports `snapshot.transport`). */
  linkKind: LinkKind | null;
  stats: MediaStats | null;
  sample: StatsSample | null;
  /** Epoch ms when this ride first connected (the ride clock); unlike `snapshot.connectedAt` it survives reconnects. */
  rideStartedAt: number | null;
  /** Latest audio route state; null until the first read answered. */
  audio: AudioRouteState | null;
  startProblem: RideStartProblem | null;
}

export interface RideStartInput {
  pairId: string;
  deviceName: string;
  allowNoHeadset: boolean;
}

export interface RideRuntimeDeps {
  createController: (deps: SessionDeps) => SessionController;
  createLink: () => LinkTransport;
  createMedia: () => MediaEngine;
  audio: AudioRoute;
  service: RideService;
  permissions: PermissionService;
  crypto: CryptoProvider;
  /**
   * Session clock, handed to the controller (heartbeat, watchdog, media grace, reconnect backoff, timeouts). On Android
   * this must be the native ride clock (`createRideClock()`): JS timers stop while the screen is off.
   */
  clock: Clock;
  /** Clock for UI-only work (the stats poller). Default `clock`. JS timers are fine here: nobody reads stats while locked. */
  uiClock?: Clock;
  logger: Logger;
  pairings: PairingRepository;
  getTunables: () => AudioTunables;
  /** Called after the runtime changed a stored pairing (partner name learned). */
  onPairingsChanged?: () => void;
  /** Stats sampling period. Default 1000 ms. */
  statsIntervalMs?: number;
}

export interface RideRuntime {
  readonly store: StoreApi<RideState>;
  /** Starts a ride unless one is already running. Resolves once the ride loop runs (not when connected). */
  start(input: RideStartInput): Promise<void>;
  setMuted(muted: boolean): void;
  /** Ends the current ride (idempotent; no-op without one). */
  end(): Promise<void>;
  /** True from start() until the controller reports `ended`. */
  isActive(): boolean;
  /** Pushes edited tunables to the running media engine (no-op between rides: the next ride reads them). */
  applyTunables(tunables: AudioTunables): void;
  /** Local interfaces, from the ride's transport (or the next ride's, created early). */
  listInterfaces(): Promise<LinkNetworkInterface[]>;
  getBattery(): Promise<BatteryInfo | null>;
  getMediaStats(): Promise<MediaStats | null>;
  /** Re-reads the audio route state (e.g. when the app returns to the foreground). */
  refreshAudio(): Promise<void>;
  /** The current pairing's secret and passphrase, for the ring log's redactor. Never display or export. */
  sensitiveValues(): readonly string[];
  /** Marks a non-ride microphone user (loopback self-test): start() refuses while it is set. */
  setMicrophoneBusy(busy: boolean): void;
}

const isLive = (snapshot: SessionSnapshot): boolean =>
  snapshot.state !== 'idle' && snapshot.state !== 'ended';

function describe(error: unknown): string {
  return error instanceof Error ? error.name : typeof error;
}

export function createRideRuntime(deps: RideRuntimeDeps): RideRuntime {
  const store = createStore<RideState>()(() => ({
    snapshot: IDLE_SNAPSHOT,
    linkKind: null,
    stats: null,
    sample: null,
    rideStartedAt: null,
    audio: null,
    startProblem: null,
  }));

  let controller: SessionController | null = null;
  let media: MediaEngine | null = null;
  let rideLink: LinkTransport | null = null;
  /** Created ahead of a ride (diagnostics asked for interfaces); handed to the next ride, never disposed unused. */
  let spareLink: LinkTransport | null = null;
  let record: PairingRecord | null = null;
  let starting = false;
  let microphoneBusy = false;
  let rideOffs: Unsubscribe[] = [];
  let lastShutdown: Promise<void> = Promise.resolve();
  let learnedName: string | null = null;

  const log = (level: 'info' | 'warn', message: string, data?: Record<string, string | number | boolean>) => {
    try {
      deps.logger.log(level, 'app', message, data);
    } catch {
      // logging must never break the ride
    }
  };

  const takeLink = (): LinkTransport => {
    const link = spareLink ?? deps.createLink();
    spareLink = null;
    return link;
  };

  const cleanupRide = () => {
    for (const off of rideOffs) off();
    rideOffs = [];
    controller = null;
    media = null;
    rideLink = null;
    learnedName = null;
  };

  const learnPartnerName = (snapshot: SessionSnapshot) => {
    const name = snapshot.peer?.name;
    const current = record;
    if (!name || !current || current.partnerName === name || learnedName === name) return;
    learnedName = name;
    const next: PairingRecord = { ...current, partnerName: name };
    record = next;
    deps.pairings.save(next).then(
      () => deps.onPairingsChanged?.(),
      (error: unknown) => log('warn', 'could not save the partner name', { error: describe(error) }),
    );
  };

  // The audio route lives for the app: Home shows the headset before any ride.
  deps.audio.onChange((audio) => store.setState({ audio }));

  const refreshAudio = async () => {
    try {
      store.setState({ audio: await deps.audio.getState() });
    } catch (error) {
      log('warn', 'audio route state unavailable', { error: describe(error) });
    }
  };
  void refreshAudio();

  const isActive = () => starting || controller !== null;

  return {
    store,

    async start(input) {
      if (isActive()) return;
      if (microphoneBusy) {
        store.setState({ startProblem: 'busy-loopback' });
        return;
      }
      starting = true;
      try {
        // A previous ride may still be releasing its link; never let two rides overlap on the native side.
        await lastShutdown;
        let found: PairingRecord | null;
        try {
          found = await deps.pairings.get(input.pairId);
        } catch {
          store.setState({ startProblem: 'storage' });
          return;
        }
        if (!found) {
          store.setState({ startProblem: 'no-pairing' });
          return;
        }
        record = found;
        const link = takeLink();
        const engine = deps.createMedia();
        const next = deps.createController({
          link,
          media: engine,
          audio: deps.audio,
          service: deps.service,
          permissions: deps.permissions,
          crypto: deps.crypto,
          clock: deps.clock,
          logger: deps.logger,
          getTunables: deps.getTunables,
        });
        controller = next;
        media = engine;
        rideLink = link;
        store.setState({
          snapshot: next.getSnapshot(),
          linkKind: link.kind,
          stats: null,
          sample: null,
          rideStartedAt: null,
          startProblem: null,
        });

        const poller = createStatsPoller({
          source: () => next.getMediaStats(),
          clock: deps.uiClock ?? deps.clock,
          intervalMs: deps.statsIntervalMs ?? 1000,
          onSample: (sample, stats) => {
            if (controller === next) store.setState({ sample, stats });
          },
        });
        const offSnapshot = next.subscribe((snapshot) => {
          if (controller !== next) return;
          const startedAt = store.getState().rideStartedAt ?? snapshot.connectedAt;
          store.setState({ snapshot, rideStartedAt: startedAt });
          learnPartnerName(snapshot);
          if (snapshot.state === 'ended') {
            cleanupRide();
          }
        });
        rideOffs = [offSnapshot, () => poller.stop()];

        log('info', 'ride start requested');
        try {
          await next.start({
            pairing: found,
            deviceName: input.deviceName,
            allowNoHeadset: input.allowNoHeadset,
          });
        } catch (error) {
          // start() rejects only for programmer errors: release whatever it took and show the final snapshot.
          log('warn', 'ride start failed', { error: describe(error) });
          await next.end().catch(() => undefined);
          if (controller === next) {
            store.setState({ snapshot: next.getSnapshot() });
            cleanupRide();
          }
        }
      } finally {
        starting = false;
      }
    },

    setMuted(muted) {
      controller?.setMuted(muted);
    },

    async end() {
      const current = controller;
      if (!current) return;
      const done = current.end();
      lastShutdown = done.then(
        () => undefined,
        () => undefined,
      );
      await lastShutdown;
      // The controller publishes `ended`; this covers a controller that ended without a final snapshot.
      if (controller === current) {
        store.setState({ snapshot: current.getSnapshot() });
        if (!isLive(current.getSnapshot())) cleanupRide();
      }
    },

    isActive,

    applyTunables(tunables) {
      const engine = media;
      if (!engine) return;
      engine.setTunables(tunables).catch((error: unknown) => {
        log('warn', 'live tunables not applied', { error: describe(error) });
      });
    },

    async listInterfaces() {
      const link = rideLink ?? (spareLink ??= deps.createLink());
      try {
        return await link.listInterfaces();
      } catch {
        return [];
      }
    },

    async getBattery() {
      try {
        return await deps.service.getBattery();
      } catch {
        return null;
      }
    },

    async getMediaStats() {
      try {
        return (await controller?.getMediaStats()) ?? null;
      } catch {
        return null;
      }
    },

    refreshAudio,

    sensitiveValues() {
      const current = record;
      return current ? [current.secret, current.wifiDirect.passphrase] : [];
    },

    setMicrophoneBusy(busy) {
      microphoneBusy = busy;
      if (!busy && store.getState().startProblem === 'busy-loopback') store.setState({ startProblem: null });
    },
  };
}
