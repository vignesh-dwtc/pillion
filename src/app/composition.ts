import type { PairingRepository } from '../core/pairing/types';
import { createCryptoProvider, type CryptoProvider } from '../core/protocol';
import { createRandomBytesSource } from '../platform/crypto';
import type { PermissionService } from '../platform/permissions/PermissionService';
import { createPermissionService } from '../platform/permissions';
import {
  createKeyValueStore,
  createMemoryKeyValueStore,
  createSecureStore,
  SecurePairingRepository,
} from '../platform/storage';
import type { KeyValueStore } from '../platform/storage/stores';

import { createPairingService, type PairingService } from './pairing';
import { createAppStore, type AppStore } from './store';
import { strings } from './strings';

/**
 * Composition root (the only place that touches platform adapters). Wired so far: storage, permissions, the crypto
 * provider (expo-crypto on native, WebCrypto on web) and the pairing service. Still to come in M1: the session
 * controller, audio route, media engine, link transport and ride service (`createSessionController({...})`), and
 * `onTunablesChanged` then forwards edits to `media.setTunables`.
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

export const keyValueStore: KeyValueStore = openKeyValueStore();
export const pairingRepository: PairingRepository = new SecurePairingRepository(createSecureStore());
export const permissionService: PermissionService = createPermissionService();

export const appStore: AppStore = createAppStore({
  kv: keyValueStore,
  pairings: pairingRepository,
  defaultDeviceName: strings.settings.defaultDeviceName,
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
