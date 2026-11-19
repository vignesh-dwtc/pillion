import type { PairingRecord } from '../../core/pairing/types';

import { createMemoryKeyValueStore, createMemorySecureStore } from './memoryStores';
import {
  InvalidPairingRecordError,
  PAIRING_RECORDS_KEY,
  SecurePairingRepository,
  normalizePairingRecord,
  parsePairingRecords,
} from './SecurePairingRepository';
import type { SecureStore } from './stores';

const SECRET_A = 'SECRET-A-do-not-leak-0123456789abcdefghijklmnopq';
const PASS_A = 'PASSPHRASE-A-do-not-leak';

function record(pairId: string, overrides: Partial<PairingRecord> = {}): PairingRecord {
  return {
    pairId,
    secret: pairId === 'pair-a' ? SECRET_A : `secret-for-${pairId}`,
    role: 'host',
    partnerName: null,
    wifiDirect: {
      networkName: `DIRECT-pn-${pairId}`,
      passphrase: pairId === 'pair-a' ? PASS_A : 'passphrase-x',
    },
    createdAt: 1_700_000_000_000,
    ...overrides,
  };
}

describe('SecurePairingRepository', () => {
  it('starts empty', async () => {
    const repo = new SecurePairingRepository(createMemorySecureStore());
    expect(await repo.list()).toEqual([]);
    expect(await repo.get('nope')).toBeNull();
  });

  it('saves and reads back a record, including the guest role and a partner name', async () => {
    const repo = new SecurePairingRepository(createMemorySecureStore());
    const saved = record('pair-a', { role: 'guest', partnerName: 'Alex' });
    await repo.save(saved);
    expect(await repo.list()).toEqual([saved]);
    expect(await repo.get('pair-a')).toEqual(saved);
  });

  it('supports several records and keeps insertion order', async () => {
    const repo = new SecurePairingRepository(createMemorySecureStore());
    await repo.save(record('pair-a'));
    await repo.save(record('pair-b', { role: 'guest' }));
    await repo.save(record('pair-c'));
    expect((await repo.list()).map((r) => r.pairId)).toEqual(['pair-a', 'pair-b', 'pair-c']);
  });

  it('upserts by pairId in place (for example when the host learns the partner name)', async () => {
    const repo = new SecurePairingRepository(createMemorySecureStore());
    await repo.save(record('pair-a'));
    await repo.save(record('pair-b'));
    await repo.save(record('pair-a', { partnerName: 'Sam' }));
    const list = await repo.list();
    expect(list.map((r) => r.pairId)).toEqual(['pair-a', 'pair-b']);
    expect(list[0]?.partnerName).toBe('Sam');
  });

  it('removes one record and leaves the others; removing an unknown id is a no-op', async () => {
    const store = createMemorySecureStore();
    const repo = new SecurePairingRepository(store);
    await repo.save(record('pair-a'));
    await repo.save(record('pair-b'));
    await repo.remove('pair-a');
    expect((await repo.list()).map((r) => r.pairId)).toEqual(['pair-b']);
    await repo.remove('unknown');
    expect((await repo.list()).map((r) => r.pairId)).toEqual(['pair-b']);
  });

  it('deletes the stored entry when the last record is removed', async () => {
    const store = createMemorySecureStore();
    const repo = new SecurePairingRepository(store);
    await repo.save(record('pair-a'));
    expect(await store.getItem(PAIRING_RECORDS_KEY)).not.toBeNull();
    await repo.remove('pair-a');
    expect(await store.getItem(PAIRING_RECORDS_KEY)).toBeNull();
    expect(await repo.list()).toEqual([]);
  });

  it('persists through the store: a second repository instance sees the records', async () => {
    const store = createMemorySecureStore();
    await new SecurePairingRepository(store).save(record('pair-a'));
    expect((await new SecurePairingRepository(store).list()).map((r) => r.pairId)).toEqual(['pair-a']);
  });

  it('stores one JSON list under one SecureStore key that expo-secure-store accepts', async () => {
    const store = createMemorySecureStore();
    await new SecurePairingRepository(store).save(record('pair-a'));
    expect(PAIRING_RECORDS_KEY).toMatch(/^[A-Za-z0-9._-]+$/);
    const raw = await store.getItem(PAIRING_RECORDS_KEY);
    expect(Array.isArray(JSON.parse(raw ?? 'null'))).toBe(true);
  });

  it('does not lose updates when saves run concurrently', async () => {
    const repo = new SecurePairingRepository(slowStore(createMemorySecureStore()));
    await Promise.all([
      repo.save(record('pair-a')),
      repo.save(record('pair-b')),
      repo.save(record('pair-c')),
    ]);
    expect((await repo.list()).map((r) => r.pairId).sort()).toEqual(['pair-a', 'pair-b', 'pair-c']);
  });

  it('rejects a malformed record without echoing its content', async () => {
    const repo = new SecurePairingRepository(createMemorySecureStore());
    const bad = { ...record('pair-a'), role: 'spectator' } as unknown as PairingRecord;
    const error = await repo.save(bad).then(
      () => null,
      (e: unknown) => e,
    );
    expect(error).toBeInstanceOf(InvalidPairingRecordError);
    expect(String(error)).not.toContain(SECRET_A);
    expect(String(error)).not.toContain(PASS_A);
    expect(await repo.list()).toEqual([]);
  });

  it('treats corrupt stored JSON as empty without throwing or leaking the content', async () => {
    const store = createMemorySecureStore({ [PAIRING_RECORDS_KEY]: `{"secret":"${SECRET_A}` });
    const repo = new SecurePairingRepository(store);
    expect(await repo.list()).toEqual([]);
    // A fresh save replaces the corrupt value.
    await repo.save(record('pair-b'));
    expect((await repo.list()).map((r) => r.pairId)).toEqual(['pair-b']);
  });

  it('drops invalid entries but keeps valid ones', async () => {
    const raw = JSON.stringify([record('pair-a'), { pairId: 'pair-x' }, 42, null, record('pair-b')]);
    const list = parsePairingRecords(raw);
    expect(list.map((r) => r.pairId)).toEqual(['pair-a', 'pair-b']);
  });

  it('keeps the first of duplicated pair ids in storage', () => {
    const raw = JSON.stringify([
      record('pair-a', { partnerName: 'first' }),
      record('pair-a', { partnerName: 'second' }),
    ]);
    expect(parsePairingRecords(raw)).toHaveLength(1);
    expect(parsePairingRecords(raw)[0]?.partnerName).toBe('first');
  });

  it('never overwrites the stored list when reading fails', async () => {
    const backing = createMemorySecureStore();
    await new SecurePairingRepository(backing).save(record('pair-a'));
    let failReads = true;
    const flaky: SecureStore = {
      getItem: (key) =>
        failReads ? Promise.reject(new Error('keystore unavailable')) : backing.getItem(key),
      setItem: (key, value) => backing.setItem(key, value),
      deleteItem: (key) => backing.deleteItem(key),
    };
    const repo = new SecurePairingRepository(flaky);
    await expect(repo.save(record('pair-b'))).rejects.toThrow('keystore unavailable');
    await expect(repo.list()).rejects.toThrow('keystore unavailable');
    failReads = false;
    expect((await repo.list()).map((r) => r.pairId)).toEqual(['pair-a']);
  });

  it('keeps working after a failed write', async () => {
    const backing = createMemorySecureStore();
    let failWrites = true;
    const flaky: SecureStore = {
      getItem: (key) => backing.getItem(key),
      setItem: (key, value) =>
        failWrites ? Promise.reject(new Error('disk full')) : backing.setItem(key, value),
      deleteItem: (key) => backing.deleteItem(key),
    };
    const repo = new SecurePairingRepository(flaky);
    await expect(repo.save(record('pair-a'))).rejects.toThrow('disk full');
    failWrites = false;
    await repo.save(record('pair-b'));
    expect((await repo.list()).map((r) => r.pairId)).toEqual(['pair-b']);
  });

  it('normalizePairingRecord keeps only the known fields', () => {
    const noisy = {
      ...record('pair-a'),
      extra: 'x',
      wifiDirect: { ...record('pair-a').wifiDirect, band: '5ghz' },
    };
    expect(normalizePairingRecord(noisy)).toEqual(record('pair-a'));
  });
});

describe('memory stores', () => {
  it('KeyValueStore: get, set, delete and list keys', () => {
    const kv = createMemoryKeyValueStore({ a: '1' });
    expect(kv.getString('a')).toBe('1');
    expect(kv.getString('b')).toBeUndefined();
    kv.setString('b', '2');
    expect(kv.getAllKeys().sort()).toEqual(['a', 'b']);
    kv.delete('a');
    expect(kv.getAllKeys()).toEqual(['b']);
  });

  it('SecureStore: get, set, delete', async () => {
    const store = createMemorySecureStore();
    expect(await store.getItem('k')).toBeNull();
    await store.setItem('k', 'v');
    expect(await store.getItem('k')).toBe('v');
    await store.deleteItem('k');
    expect(await store.getItem('k')).toBeNull();
  });
});

/** Adds latency to every call so interleaving bugs show up. */
function slowStore(inner: SecureStore): SecureStore {
  const delay = () => new Promise<void>((resolve) => setTimeout(resolve, 2));
  return {
    getItem: async (key) => {
      await delay();
      return inner.getItem(key);
    },
    setItem: async (key, value) => {
      await delay();
      return inner.setItem(key, value);
    },
    deleteItem: async (key) => {
      await delay();
      return inner.deleteItem(key);
    },
  };
}
