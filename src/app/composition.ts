import type { PairingRepository } from '../core/pairing/types';
import type { PermissionService } from '../platform/permissions/PermissionService';
import { createPermissionService } from '../platform/permissions';
import {
  createKeyValueStore,
  createMemoryKeyValueStore,
  createSecureStore,
  SecurePairingRepository,
} from '../platform/storage';
import type { KeyValueStore } from '../platform/storage/stores';

import { createAppStore, type AppStore } from './store';
import { strings } from './strings';

/**
 * Composition root (the only place that touches platform adapters). M0 wires storage and permissions only: the
 * session controller, audio route, media engine, link transport and ride service are added here in M1
 * (`createSessionController({...})`), and `onTunablesChanged` then forwards edits to `media.setTunables`.
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
