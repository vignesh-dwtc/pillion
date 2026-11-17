/**
 * Web twin of createSecureStore. INSECURE, DEVELOPMENT ONLY.
 *
 * Values are kept in plain text in `localStorage` (or in memory when localStorage is unavailable), readable by any script
 * on the page and by anyone with the browser profile. The Android build stores pairing records in the Keystore-backed
 * expo-secure-store instead. This stand-in exists so the pairing flow can run in the web verification target; never
 * ship it, never put real secrets in it.
 *
 * It enforces the same key rules as expo-secure-store so a bad key fails on the web target too, not only on a phone.
 */
import type { SecureStore } from './stores';

/** Greppable by scripts/check-android-bundle.mjs: this string must never appear in the Android bundle. */
export const WEB_ONLY_INSECURE_SECURE_STORE = '@@web-only:InsecureLocalStorageSecureStore@@';

const KEY_PREFIX = 'insecure-dev-store.';
const VALID_KEY = /^[\w.-]+$/;
const memory = new Map<string, string>();
let warned = false;

function browserStorage(): Storage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null; // storage disabled by the browser
  }
}

function assertValidKey(key: string): void {
  if (!VALID_KEY.test(key)) {
    throw new Error(
      'Invalid key provided to SecureStore. Keys must not be empty and contain only alphanumeric characters, ".", "-", and "_".',
    );
  }
}

function warnOnce(): void {
  if (warned) return;
  warned = true;
  console.warn('INSECURE dev-only secure store: pairing data is kept in plain text in localStorage on web.');
}

export function createSecureStore(): SecureStore {
  return {
    async getItem(key) {
      assertValidKey(key);
      warnOnce();
      const storage = browserStorage();
      return storage ? storage.getItem(KEY_PREFIX + key) : (memory.get(key) ?? null);
    },
    async setItem(key, value) {
      assertValidKey(key);
      warnOnce();
      const storage = browserStorage();
      if (storage) storage.setItem(KEY_PREFIX + key, value);
      else memory.set(key, value);
    },
    async deleteItem(key) {
      assertValidKey(key);
      const storage = browserStorage();
      if (storage) storage.removeItem(KEY_PREFIX + key);
      else memory.delete(key);
    },
  };
}
