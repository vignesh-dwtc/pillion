import { DEFAULT_AUDIO_TUNABLES } from '../../../platform/audio/AudioTunables';
import type { LinkRole } from '../../../platform/link/LinkTransport';
import type { Logger } from '../../common/types';
import type { PairingRecord } from '../../pairing/types';
import type { CryptoProvider } from '../../protocol/crypto';
import type { EstablishSecureChannel } from '../../protocol/secureChannel';
import { createSessionController, type SessionControllerWithStats } from '../createSessionController';
import type { SessionConfig, SessionSnapshot, SessionStartOptions, SessionState } from '../types';
import { FakeAudioRoute } from './FakeAudioRoute';
import { FakeMediaEngine, FakeMediaFabric, type FakeMediaOptions } from './FakeMediaEngine';
import { FakePermissionService } from './FakePermissionService';
import { FakeRideService } from './FakeRideService';
import { establishFakeSecureChannel } from './FakeSecureChannel';
import {
  type InMemoryLinkHub,
  type InMemoryLinkTransport,
  createInMemoryLinkPair,
  type InMemoryLinkOptions,
} from './InMemoryLinkTransport';
import { FakeNetwork } from './FakeNetwork';
import { ManualClock } from './ManualClock';
import { MemoryLogger } from './MemoryLogger';
import { makeTestPairing } from './pairingFixtures';
import { createSeededCrypto } from './seededRandom';

/**
 * The two-peer simulation: a host controller and a guest controller, each with its own fake platform, wired to
 * each other through an in-memory link and a fake media fabric that share one `FakeNetwork` and one `ManualClock`.
 * Everything is deterministic: advance time with `advance()` / `runUntil()` and the same scenario plays out the
 * same way every run.
 *
 * What it can prove: the state machine, signaling order, generations, heartbeats, backoff and recovery, mute
 * sync, bye, error mapping, resource release. What it cannot: real sockets, real WebRTC, any hardware.
 */

export interface PeerRig {
  role: LinkRole;
  controller: SessionControllerWithStats;
  link: InMemoryLinkTransport;
  media: FakeMediaEngine;
  audio: FakeAudioRoute;
  service: FakeRideService;
  permissions: FakePermissionService;
  logger: MemoryLogger;
  pairing: PairingRecord;
  /** Every snapshot the controller published (distinct objects), oldest first. */
  history: SessionSnapshot[];
  snapshot(): SessionSnapshot;
  /** The sequence of states the controller went through (consecutive duplicates removed). */
  states(): SessionState[];
  start(overrides?: Partial<SessionStartOptions>): Promise<void>;
}

export interface TwoPeerOptions {
  seed?: number;
  config?: Partial<SessionConfig>;
  link?: Omit<InMemoryLinkOptions, 'clock' | 'network'>;
  media?: Omit<FakeMediaOptions, 'clock' | 'network'>;
  /** Secure channel used by both sides unless overridden per side. Default: the stand-in. */
  establish?: EstablishSecureChannel;
  hostEstablish?: EstablishSecureChannel;
  guestEstablish?: EstablishSecureChannel;
  crypto?: (seed: number) => CryptoProvider;
  /** Different secret bytes make the two phones distrust each other. */
  hostSecretByte?: number;
  guestSecretByte?: number;
  hostPairIdByte?: number;
  guestPairIdByte?: number;
  hostHeadset?: boolean;
  guestHeadset?: boolean;
  /** Replaces the default MemoryLogger of a peer (for example a RingLog). */
  hostLogger?: (clock: ManualClock) => Logger & Partial<MemoryLogger>;
  guestLogger?: (clock: ManualClock) => Logger & Partial<MemoryLogger>;
}

export interface TwoPeerHarness {
  clock: ManualClock;
  network: FakeNetwork;
  linkHub: InMemoryLinkHub;
  mediaFabric: FakeMediaFabric;
  host: PeerRig;
  guest: PeerRig;
  /** Starts both rides. */
  startBoth(): Promise<void>;
  advance(ms: number): Promise<void>;
  settle(): Promise<void>;
  /**
   * Advances virtual time in `stepMs` steps until `predicate()` holds; throws (with both snapshots and the tail of
   * both logs) when it does not within `maxMs`. Returns the virtual time that passed.
   */
  runUntil(
    predicate: () => boolean,
    options?: { maxMs?: number; stepMs?: number; label?: string },
  ): Promise<number>;
  bothConnected(): boolean;
  /** Everything useful in a failure message. */
  dump(): string;
}

function createRig(
  role: LinkRole,
  shared: {
    clock: ManualClock;
    link: InMemoryLinkTransport;
    media: FakeMediaEngine;
    establish: EstablishSecureChannel;
    crypto: CryptoProvider;
    config: Partial<SessionConfig> | undefined;
    pairing: PairingRecord;
    headset: boolean;
    logger: Logger & Partial<MemoryLogger>;
  },
): PeerRig {
  const audio = new FakeAudioRoute({ headsetConnected: shared.headset });
  const service = new FakeRideService();
  const permissions = new FakePermissionService();
  const controller = createSessionController({
    link: shared.link,
    media: shared.media,
    audio,
    service,
    permissions,
    crypto: shared.crypto,
    clock: shared.clock,
    logger: shared.logger,
    getTunables: () => DEFAULT_AUDIO_TUNABLES,
    establishSecureChannel: shared.establish,
    config: shared.config,
  });
  const history: SessionSnapshot[] = [controller.getSnapshot()];
  controller.subscribe((snapshot) => history.push(snapshot));
  const rig: PeerRig = {
    role,
    controller,
    link: shared.link,
    media: shared.media,
    audio,
    service,
    permissions,
    logger: shared.logger as MemoryLogger,
    pairing: shared.pairing,
    history,
    snapshot: () => controller.getSnapshot(),
    states: () => {
      const out: SessionState[] = [];
      for (const snapshot of history) {
        if (out[out.length - 1] !== snapshot.state) out.push(snapshot.state);
      }
      return out;
    },
    start: (overrides = {}) =>
      controller.start({
        pairing: shared.pairing,
        deviceName: role === 'host' ? 'Rider' : 'Pillion',
        allowNoHeadset: false,
        ...overrides,
      }),
  };
  return rig;
}

export function createTwoPeerHarness(options: TwoPeerOptions = {}): TwoPeerHarness {
  const seed = options.seed ?? 1;
  const clock = new ManualClock(1_000_000);
  const network = new FakeNetwork();
  const links = createInMemoryLinkPair({ ...options.link, clock, network });
  const mediaFabric = new FakeMediaFabric({ ...options.media, clock, network });
  const hostMedia = new FakeMediaEngine(mediaFabric, 'host');
  const guestMedia = new FakeMediaEngine(mediaFabric, 'guest');
  const makeCrypto = options.crypto ?? createSeededCrypto;
  const establish = options.establish ?? establishFakeSecureChannel;

  const host = createRig('host', {
    clock,
    link: links.host,
    media: hostMedia,
    establish: options.hostEstablish ?? establish,
    crypto: makeCrypto(seed * 2),
    config: options.config,
    pairing: makeTestPairing('host', {
      secretByte: options.hostSecretByte,
      pairIdByte: options.hostPairIdByte,
    }),
    headset: options.hostHeadset ?? true,
    logger: options.hostLogger?.(clock) ?? new MemoryLogger(clock),
  });
  const guest = createRig('guest', {
    clock,
    link: links.guest,
    media: guestMedia,
    establish: options.guestEstablish ?? establish,
    crypto: makeCrypto(seed * 2 + 1),
    config: options.config,
    pairing: makeTestPairing('guest', {
      secretByte: options.guestSecretByte,
      pairIdByte: options.guestPairIdByte,
    }),
    headset: options.guestHeadset ?? true,
    logger: options.guestLogger?.(clock) ?? new MemoryLogger(clock),
  });

  const brief = (rig: PeerRig): string => {
    const s = rig.snapshot();
    return `${rig.role}: state=${s.state} generation=${s.generation} attempt=${s.attempt} error=${s.error?.code ?? 'none'} muted=${s.muted}`;
  };

  const harness: TwoPeerHarness = {
    clock,
    network,
    linkHub: links.hub,
    mediaFabric,
    host,
    guest,
    async startBoth() {
      await host.start();
      await guest.start();
    },
    advance: (ms) => clock.advance(ms),
    settle: () => clock.settle(),
    bothConnected: () => host.snapshot().state === 'connected' && guest.snapshot().state === 'connected',
    dump() {
      return [
        `virtual time ${clock.now()}`,
        brief(host),
        brief(guest),
        `link events:\n${links.hub.events.slice(-12).join('\n')}`,
        `host log:\n${host.logger.tail(12)}`,
        `guest log:\n${guest.logger.tail(12)}`,
      ].join('\n');
    },
    async runUntil(predicate, runOptions = {}) {
      const maxMs = runOptions.maxMs ?? 120_000;
      const stepMs = runOptions.stepMs ?? 100;
      let elapsed = 0;
      await clock.settle();
      while (!predicate()) {
        if (elapsed >= maxMs) {
          throw new Error(
            `runUntil(${runOptions.label ?? 'condition'}) not met within ${maxMs} virtual ms\n${harness.dump()}`,
          );
        }
        await clock.advance(stepMs);
        elapsed += stepMs;
      }
      return elapsed;
    },
  };
  return harness;
}
