import { systemClock } from '../core/common/types';
import { createRingLog, type RingLogImpl } from '../core/diagnostics';
import type { PairingRepository } from '../core/pairing/types';
import { createCryptoProvider, type CryptoProvider } from '../core/protocol';
import { createSessionController } from '../core/session';
import { createAudioRoute } from '../platform/audio';
import type { AudioRoute } from '../platform/audio/AudioRoute';
import type { AudioTunables } from '../platform/audio/AudioTunables';
import { createRandomBytesSource } from '../platform/crypto';
import { createLinkTransport } from '../platform/link';
import {
  createMediaEngine,
  startLoopbackSelfTest,
  type LoopbackOptions,
  type LoopbackRun,
} from '../platform/media';
import type { PermissionService } from '../platform/permissions/PermissionService';
import { createPermissionService } from '../platform/permissions';
import { createRideClock, createRideService } from '../platform/service';
import type { RideService } from '../platform/service/RideService';
import {
  createKeyValueStore,
  createMemoryKeyValueStore,
  createSecureStore,
  SecurePairingRepository,
} from '../platform/storage';
import type { KeyValueStore } from '../platform/storage/stores';

import { createPairingService, type PairingService } from './pairing';
import { createRideRuntime, type RideRuntime } from './ride';
import { createAppStore, type AppStore } from './store';
import { strings } from './strings';

/**
 * Composition root: the ONLY place that creates platform adapters. Every factory comes from the shared
 * `src/platform/<area>/index.ts` barrel, so Metro bundles the native implementation on Android and the `.web.ts` twin
 * on web without a single platform check here.
 *
 *   storage       MMKV key-value store (settings, tunables, ring log) + Keystore-backed pairing repository
 *   permissions   PermissionsAndroid wrapper
 *   crypto        expo-crypto randomness behind the core CryptoProvider
 *   ring log      core/diagnostics ring buffer, persisted in MMKV, redacting the pairing secret and passphrase
 *   ride          the live session: createSessionController with the link transport (LAN in M1), WebRTC media engine,
 *                 audio route and foreground ride service; one controller per ride (see ride.ts). The controller runs on
 *                 the native ride clock (createRideClock) so its timers survive screen-off
 *   loopback      a dedicated media engine per self-test, never the ride's
 */

function openKeyValueStore(): KeyValueStore {
  try {
    return createKeyValueStore();
  } catch (error) {
    // The app must still open if MMKV cannot start (a rider cannot debug a blank screen in a pocket):
    // settings then live in memory for this run only.
    console.error(
      `Settings storage unavailable, using memory only: ${error instanceof Error ? error.message : 'unknown'}`,
    );
    return createMemoryKeyValueStore();
  }
}

/** Ring-log persistence key (format version inside the value). */
export const RING_LOG_KEY = 'diagnostics.log.v1';

export const keyValueStore: KeyValueStore = openKeyValueStore();
export const pairingRepository: PairingRepository = new SecurePairingRepository(createSecureStore());
export const permissionService: PermissionService = createPermissionService();
export const audioRoute: AudioRoute = createAudioRoute();
export const rideService: RideService = createRideService();

/** Late-bound: the store's tunables listener and the ring log's redactor both need the runtime created below. */
let runtime: RideRuntime | null = null;

export const ringLog: RingLogImpl = createRingLog({
  clock: systemClock,
  persistence: {
    load: () => keyValueStore.getString(RING_LOG_KEY),
    save: (serialized) => keyValueStore.setString(RING_LOG_KEY, serialized),
  },
  sensitiveValues: () => runtime?.sensitiveValues() ?? [],
});

export const appStore: AppStore = createAppStore({
  kv: keyValueStore,
  pairings: pairingRepository,
  defaultDeviceName: strings.settings.defaultDeviceName,
  // Debug-screen edits apply live to the running ride (and are read by the next ride at start).
  onTunablesChanged: (tunables: AudioTunables) => runtime?.applyTunables(tunables),
});

/** Randomness: expo-crypto `getRandomValues` on native, `crypto.getRandomValues` on web (platform twin). */
export const cryptoProvider: CryptoProvider = createCryptoProvider(createRandomBytesSource());

/** Host offer / guest scan. Every change re-reads the store's pairing summaries (which never hold a secret). */
export const pairingService: PairingService = createPairingService({
  repository: pairingRepository,
  crypto: cryptoProvider,
  now: () => Date.now(),
  onChanged: () => appStore.getState().refreshPairings(),
});

export const rideRuntime: RideRuntime = createRideRuntime({
  createController: createSessionController,
  createLink: createLinkTransport,
  createMedia: createMediaEngine,
  audio: audioRoute,
  service: rideService,
  permissions: permissionService,
  crypto: cryptoProvider,
  // Native Handler-thread timers on Android (process-wide, the same instance the LAN transport uses), so heartbeats,
  // watchdog and reconnect backoff keep running with the screen off; `systemClock` on web.
  clock: createRideClock(),
  uiClock: systemClock,
  logger: ringLog,
  pairings: pairingRepository,
  getTunables: () => appStore.getState().tunables,
  onPairingsChanged: () => void appStore.getState().refreshPairings(),
});
runtime = rideRuntime;

/**
 * Loopback self-test on a dedicated media engine (the test starts and always stops it). Refused while a ride is
 * active: the ride owns the microphone. While it runs, Begin ride is refused instead.
 */
export function startLoopback(options: Omit<LoopbackOptions, 'tunables' | 'clock'>): LoopbackRun | null {
  if (rideRuntime.isActive()) return null;
  rideRuntime.setMicrophoneBusy(true);
  ringLog.log('info', 'loopback', 'self-test started');
  const run = startLoopbackSelfTest(createMediaEngine(), {
    ...options,
    tunables: appStore.getState().tunables,
    clock: systemClock,
  });
  void run.result.then(
    (result) => {
      ringLog.log(result.ok ? 'info' : 'warn', 'loopback', 'self-test finished', {
        ok: result.ok,
        failure: result.failure,
        connectMs: result.connectMs,
        bytesSent: result.bytesSent,
        bytesReceived: result.bytesReceived,
      });
    },
    () => undefined,
  );
  void run.result.finally(() => rideRuntime.setMicrophoneBusy(false)).catch(() => undefined);
  return run;
}
