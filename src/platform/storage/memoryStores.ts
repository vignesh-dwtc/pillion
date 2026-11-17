import type { KeyValueStore, SecureStore } from './stores';

/**
 * In-memory implementations of the storage ports. Pure TypeScript (no native modules): used by unit tests, and by
 * the composition root as a last-resort fallback when MMKV cannot start, so the app still opens (settings then
 * do not persist, and the failure is logged). NOT secure: never use as the real pairing store.
 */

export function createMemoryKeyValueStore(initial: Record<string, string> = {}): KeyValueStore {
  const map = new Map<string, string>(Object.entries(initial));
  return {
    getString: (key) => map.get(key),
    setString: (key, value) => {
      map.set(key, value);
    },
    delete: (key) => {
      map.delete(key);
    },
    getAllKeys: () => Array.from(map.keys()),
  };
}

export function createMemorySecureStore(initial: Record<string, string> = {}): SecureStore {
  const map = new Map<string, string>(Object.entries(initial));
  return {
    getItem: async (key) => map.get(key) ?? null,
    setItem: async (key, value) => {
      map.set(key, value);
    },
    deleteItem: async (key) => {
      map.delete(key);
    },
  };
}
