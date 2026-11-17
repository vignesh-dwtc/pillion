import type { PairingRecord, PairingRepository } from '../core/pairing/types';
import {
  AUDIO_TUNABLE_LIMITS,
  DEFAULT_AUDIO_TUNABLES,
  type AudioTunables,
} from '../platform/audio/AudioTunables';
import { createMemoryKeyValueStore, createMemorySecureStore } from '../platform/storage/memoryStores';
import { SecurePairingRepository } from '../platform/storage/SecurePairingRepository';

import {
  DEVICE_NAME_MAX_LENGTH,
  SETTINGS_KEY,
  TUNABLES_KEY,
  clampBitrate,
  parseSettings,
  defaultSettings,
  sanitizeDeviceName,
  sanitizeTunables,
} from './persistence';
import { createAppStore, selectAllowNoHeadset, summarizePairing } from './store';

const SECRET = 'THE-SECRET-VALUE-0123456789';
const PASSPHRASE = 'THE-WIFI-PASSPHRASE';

function pairing(pairId: string, overrides: Partial<PairingRecord> = {}): PairingRecord {
  return {
    pairId,
    secret: SECRET,
    role: 'guest',
    partnerName: 'Alex',
    wifiDirect: { networkName: 'DIRECT-pn-test', passphrase: PASSPHRASE },
    createdAt: 1_700_000_000_000,
    ...overrides,
  };
}

function setup(
  options: { kv?: ReturnType<typeof createMemoryKeyValueStore>; repo?: PairingRepository } = {},
) {
  const kv = options.kv ?? createMemoryKeyValueStore();
  const repo = options.repo ?? new SecurePairingRepository(createMemorySecureStore());
  const changed: AudioTunables[] = [];
  const store = createAppStore({
    kv,
    pairings: repo,
    defaultDeviceName: 'My phone',
    onTunablesChanged: (t) => changed.push(t),
  });
  return { kv, repo, store, changed };
}

describe('createAppStore: defaults and persistence', () => {
  it('starts with safe defaults', () => {
    const { store } = setup();
    const s = store.getState();
    expect(s.deviceName).toBe('My phone');
    expect(s.developerMode).toBe(false);
    expect(s.allowNoHeadset).toBe(false);
    expect(s.onboardingDone).toBe(false);
    expect(s.tunables).toEqual(DEFAULT_AUDIO_TUNABLES);
    expect(s.pairings).toEqual([]);
    expect(s.pairingsStatus).toBe('loading');
  });

  it('persists settings and restores them in a new store over the same storage', () => {
    const { kv, store } = setup();
    store.getState().setDeviceName('  Rider  ');
    store.getState().setDeveloperMode(true);
    store.getState().setAllowNoHeadset(true);
    store.getState().completeOnboarding();

    const again = createAppStore({
      kv,
      pairings: new SecurePairingRepository(createMemorySecureStore()),
      defaultDeviceName: 'x',
    });
    const s = again.getState();
    expect(s.deviceName).toBe('Rider');
    expect(s.developerMode).toBe(true);
    expect(s.allowNoHeadset).toBe(true);
    expect(s.onboardingDone).toBe(true);
  });

  it('falls back to defaults when stored values are corrupt', () => {
    const kv = createMemoryKeyValueStore({ [SETTINGS_KEY]: '{not json', [TUNABLES_KEY]: '[1,2,3]' });
    const { store } = setup({ kv });
    expect(store.getState().deviceName).toBe('My phone');
    expect(store.getState().tunables).toEqual(DEFAULT_AUDIO_TUNABLES);
  });

  it('never restores the override without developer mode, even from a hand-edited value', () => {
    const defaults = defaultSettings('My phone');
    const parsed = parseSettings(JSON.stringify({ developerMode: false, allowNoHeadset: true }), defaults);
    expect(parsed.allowNoHeadset).toBe(false);
  });
});

describe('device name', () => {
  it('trims, limits to 24 characters and falls back when empty', () => {
    const { store } = setup();
    store.getState().setDeviceName('   ');
    expect(store.getState().deviceName).toBe('My phone');
    store.getState().setDeviceName('A'.repeat(40));
    expect(store.getState().deviceName).toHaveLength(DEVICE_NAME_MAX_LENGTH);
  });

  it('cuts by code points so an emoji is never split', () => {
    const name = sanitizeDeviceName('\u{1F3CD}'.repeat(30), 'x');
    expect(Array.from(name)).toHaveLength(DEVICE_NAME_MAX_LENGTH);
    expect(name).not.toContain('�');
  });

  it('strips control characters', () => {
    expect(sanitizeDeviceName('Ri\nder\t', 'x')).toBe('Rider');
  });
});

describe('developer mode', () => {
  it('turning developer mode off also clears the override', () => {
    const { store } = setup();
    store.getState().setDeveloperMode(true);
    store.getState().setAllowNoHeadset(true);
    expect(selectAllowNoHeadset(store.getState())).toBe(true);
    store.getState().setDeveloperMode(false);
    expect(store.getState().allowNoHeadset).toBe(false);
    expect(selectAllowNoHeadset(store.getState())).toBe(false);
  });

  it('ignores the override toggle while developer mode is off', () => {
    const { store } = setup();
    store.getState().setAllowNoHeadset(true);
    expect(store.getState().allowNoHeadset).toBe(false);
  });

  it('the selector gates a stored override on developer mode', () => {
    expect(selectAllowNoHeadset({ developerMode: false, allowNoHeadset: true })).toBe(false);
    expect(selectAllowNoHeadset({ developerMode: true, allowNoHeadset: true })).toBe(true);
  });
});

describe('audio tunables editing state', () => {
  it('applies a partial change, persists it and notifies the listener once', () => {
    const { kv, store, changed } = setup();
    store.getState().setTunables({ noiseSuppression: false, opusBitrateBps: 32_000 });
    expect(store.getState().tunables.noiseSuppression).toBe(false);
    expect(store.getState().tunables.opusBitrateBps).toBe(32_000);
    expect(changed).toHaveLength(1);
    expect(JSON.parse(kv.getString(TUNABLES_KEY) ?? '{}')).toMatchObject({
      noiseSuppression: false,
      opusBitrateBps: 32_000,
    });

    const again = setup({ kv });
    expect(again.store.getState().tunables.opusBitrateBps).toBe(32_000);
  });

  it('keeps every value inside AUDIO_TUNABLE_LIMITS', () => {
    const { store } = setup();
    store.getState().setTunables({ opusBitrateBps: 1 });
    expect(store.getState().tunables.opusBitrateBps).toBe(AUDIO_TUNABLE_LIMITS.opusBitrateBps.min);
    store.getState().setTunables({ opusBitrateBps: 10_000_000 });
    expect(store.getState().tunables.opusBitrateBps).toBe(AUDIO_TUNABLE_LIMITS.opusBitrateBps.max);
    store.getState().setTunables({ opusPacketTimeMs: 33 as never });
    expect(AUDIO_TUNABLE_LIMITS.opusPacketTimeMs).toContain(store.getState().tunables.opusPacketTimeMs);
  });

  it('does not notify or write when nothing changes', () => {
    const { kv, store, changed } = setup();
    store.getState().setTunables({ noiseSuppression: DEFAULT_AUDIO_TUNABLES.noiseSuppression });
    store.getState().resetTunables();
    expect(changed).toHaveLength(0);
    expect(kv.getString(TUNABLES_KEY)).toBeUndefined();
  });

  it('resets to the defaults and notifies', () => {
    const { store, changed } = setup();
    store.getState().setTunables({ opusDtx: true, opusPacketTimeMs: 60 });
    store.getState().resetTunables();
    expect(store.getState().tunables).toEqual(DEFAULT_AUDIO_TUNABLES);
    expect(changed).toHaveLength(2);
  });

  it('sanitizeTunables repairs untrusted input field by field', () => {
    const repaired = sanitizeTunables({
      noiseSuppression: 'yes',
      opusBitrateBps: NaN,
      opusPacketTimeMs: 25,
      opusFec: false,
      extra: 1,
    });
    expect(repaired).toEqual({ ...DEFAULT_AUDIO_TUNABLES, opusFec: false });
    expect(clampBitrate(24_499.6)).toBe(24_500);
  });
});

describe('pairings', () => {
  it('loads summaries that never contain the secret or the Wi-Fi credentials', async () => {
    const repo = new SecurePairingRepository(createMemorySecureStore());
    await repo.save(pairing('pair-a'));
    const { store } = setup({ repo });
    await store.getState().refreshPairings();
    const s = store.getState();
    expect(s.pairingsStatus).toBe('ready');
    expect(s.pairings).toEqual([
      { pairId: 'pair-a', role: 'guest', partnerName: 'Alex', createdAt: 1_700_000_000_000 },
    ]);
    const dump = JSON.stringify(s.pairings);
    expect(dump).not.toContain(SECRET);
    expect(dump).not.toContain(PASSPHRASE);
    expect(summarizePairing(pairing('x'))).not.toHaveProperty('secret');
  });

  it('keeps the previous list and reports an error when the repository fails', async () => {
    let fail = false;
    const inner = new SecurePairingRepository(createMemorySecureStore());
    await inner.save(pairing('pair-a'));
    const repo: PairingRepository = {
      list: () => (fail ? Promise.reject(new Error('keystore')) : inner.list()),
      get: (id) => inner.get(id),
      save: (r) => inner.save(r),
      remove: (id) => inner.remove(id),
    };
    const { store } = setup({ repo });
    await store.getState().refreshPairings();
    fail = true;
    await store.getState().refreshPairings();
    expect(store.getState().pairingsStatus).toBe('error');
    expect(store.getState().pairings).toHaveLength(1);
  });

  it('removes a pairing and refreshes the list', async () => {
    const repo = new SecurePairingRepository(createMemorySecureStore());
    await repo.save(pairing('pair-a'));
    await repo.save(pairing('pair-b', { role: 'host', partnerName: null }));
    const { store } = setup({ repo });
    await store.getState().refreshPairings();
    await store.getState().removePairing('pair-a');
    expect(store.getState().pairings.map((p) => p.pairId)).toEqual(['pair-b']);
    expect(await repo.get('pair-a')).toBeNull();
  });
});
