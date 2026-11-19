import * as ExpoSecureStore from 'expo-secure-store';

import type { SecureStore } from './stores';

/**
 * Native SecureStore: Android Keystore-backed through expo-secure-store (values are AES-encrypted with a key that
 * lives in the Keystore, see the expo-secure-store docs). Holds the pairing records, so the secret and the Wi-Fi
 * passphrase are never written anywhere else and never logged.
 *
 * Keys may only contain alphanumerics, '.', '-' and '_' (expo-secure-store rejects anything else).
 * The web twin (`createSecureStore.web.ts`, owned by `web-verify`) is a localStorage stand-in for development.
 */
export function createSecureStore(): SecureStore {
  return {
    getItem: (key) => ExpoSecureStore.getItemAsync(key),
    setItem: (key, value) => ExpoSecureStore.setItemAsync(key, value),
    deleteItem: (key) => ExpoSecureStore.deleteItemAsync(key),
  };
}
