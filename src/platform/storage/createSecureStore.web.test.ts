import { createSecureStore } from './createSecureStore.web';
import type * as SecureStoreModule from './createSecureStore.web';

class FakeLocalStorage {
  readonly data = new Map<string, string>();
  getItem(key: string) {
    return this.data.get(key) ?? null;
  }
  setItem(key: string, value: string) {
    this.data.set(key, value);
  }
  removeItem(key: string) {
    this.data.delete(key);
  }
}

type Scope = { localStorage?: unknown };
const scope = globalThis as unknown as Scope;

afterEach(() => {
  delete scope.localStorage;
  jest.restoreAllMocks();
});

describe('web SecureStore (INSECURE dev stand-in)', () => {
  it('round-trips values through localStorage under a prefixed key, and deletes them', async () => {
    const storage = new FakeLocalStorage();
    scope.localStorage = storage;
    jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    const store = createSecureStore();

    expect(await store.getItem('pairings')).toBeNull();
    await store.setItem('pairings', '[{"a":1}]');
    expect(await store.getItem('pairings')).toBe('[{"a":1}]');
    expect([...storage.data.keys()]).toEqual(['insecure-dev-store.pairings']);

    await store.deleteItem('pairings');
    expect(await store.getItem('pairings')).toBeNull();
    expect(storage.data.size).toBe(0);
  });

  it('falls back to memory when localStorage is missing or throws', async () => {
    jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    const store = createSecureStore();
    await store.setItem('in.memory', 'v1');
    expect(await store.getItem('in.memory')).toBe('v1');

    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      get() {
        throw new Error('SecurityError: storage disabled');
      },
    });
    await store.setItem('after.throw', 'v2');
    expect(await store.getItem('after.throw')).toBe('v2');
    await store.deleteItem('after.throw');
    expect(await store.getItem('after.throw')).toBeNull();
    delete (globalThis as { localStorage?: unknown }).localStorage;
  });

  it('enforces the same key rules as expo-secure-store', async () => {
    jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    const store = createSecureStore();
    for (const bad of ['', 'has space', 'slash/key', 'colon:key', 'ümlaut']) {
      await expect(store.setItem(bad, 'x')).rejects.toThrow(/Invalid key/);
      await expect(store.getItem(bad)).rejects.toThrow(/Invalid key/);
      await expect(store.deleteItem(bad)).rejects.toThrow(/Invalid key/);
    }
    await expect(store.setItem('ok.key-1_x', 'x')).resolves.toBeUndefined();
  });

  it('warns that it is insecure (once per page load)', async () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    jest.resetModules();
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const fresh = require('./createSecureStore.web') as typeof SecureStoreModule;
    const store = fresh.createSecureStore();
    await store.setItem('k', 'v');
    await store.getItem('k');
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0]?.[0])).toMatch(/INSECURE/);
  });
});
