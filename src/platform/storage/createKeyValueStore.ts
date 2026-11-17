import { createMMKV } from 'react-native-mmkv';

import type { KeyValueStore } from './stores';

/** MMKV instance id for the app's settings, tunables, onboarding flags and the diagnostics ring buffer. */
export const APP_STORAGE_ID = 'app';

/**
 * Fast synchronous storage for non-secret data (settings, audio tunables, onboarding flag, diagnostics log).
 * MMKV 4 is a Nitro module on Android; on web `react-native-mmkv` resolves its own localStorage-backed
 * `createMMKV.web`, so this single file serves both targets (no web twin needed).
 * Secrets never go here: see `createSecureStore`.
 */
export function createKeyValueStore(id: string = APP_STORAGE_ID): KeyValueStore {
  const mmkv = createMMKV({ id });
  return {
    getString: (key) => mmkv.getString(key),
    setString: (key, value) => {
      mmkv.set(key, value);
    },
    delete: (key) => {
      mmkv.remove(key);
    },
    getAllKeys: () => mmkv.getAllKeys(),
  };
}
