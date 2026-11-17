import type { PairingRecord, PairingRepository } from '../../core/pairing/types';

import type { SecureStore } from './stores';

/**
 * SecureStore key holding the JSON list of pairing records.
 * expo-secure-store only accepts alphanumerics, '.', '-' and '_' in keys. The `.v1` suffix is the storage format
 * version: a future incompatible format uses a new key and migrates.
 */
export const PAIRING_RECORDS_KEY = 'pairing.records.v1';

/** Thrown by `save` for a malformed record. The message deliberately carries no record content. */
export class InvalidPairingRecordError extends Error {
  constructor() {
    super('Invalid pairing record');
    this.name = 'InvalidPairingRecordError';
  }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

/**
 * Validates one stored/saved record and returns a clean copy that only carries the known fields, or null.
 * Never includes any value in an error or log: the record holds the pairing secret and the Wi-Fi passphrase.
 */
export function normalizePairingRecord(value: unknown): PairingRecord | null {
  if (!isPlainObject(value)) return null;
  const { pairId, secret, role, partnerName, wifiDirect, createdAt } = value;
  if (!isNonEmptyString(pairId) || !isNonEmptyString(secret)) return null;
  if (role !== 'host' && role !== 'guest') return null;
  if (partnerName !== null && typeof partnerName !== 'string') return null;
  if (!isPlainObject(wifiDirect)) return null;
  const { networkName, passphrase } = wifiDirect;
  if (typeof networkName !== 'string' || typeof passphrase !== 'string') return null;
  if (typeof createdAt !== 'number' || !Number.isFinite(createdAt)) return null;
  return {
    pairId,
    secret,
    role,
    partnerName,
    wifiDirect: { networkName, passphrase },
    createdAt,
  };
}

/**
 * Parses the stored JSON. Corrupt JSON yields an empty list and invalid entries are dropped; duplicates keep the
 * first occurrence. The JSON parser's own error is swallowed on purpose: some engines quote a snippet of the
 * input, and the input is secret material.
 */
export function parsePairingRecords(raw: string | null): PairingRecord[] {
  if (raw === null || raw === '') return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  const seen = new Set<string>();
  const records: PairingRecord[] = [];
  for (const entry of parsed) {
    const record = normalizePairingRecord(entry);
    if (record && !seen.has(record.pairId)) {
      seen.add(record.pairId);
      records.push(record);
    }
  }
  return records;
}

/**
 * PairingRepository over a SecureStore: one JSON list of records under one key, so a phone can hold several
 * pairings (stage 1 uses one). Operations are serialised so concurrent read-modify-write calls cannot lose
 * updates. A failing read or write rejects and leaves the stored list untouched.
 */
export class SecurePairingRepository implements PairingRepository {
  private tail: Promise<unknown> = Promise.resolve();

  constructor(
    private readonly store: SecureStore,
    private readonly key: string = PAIRING_RECORDS_KEY,
  ) {}

  list(): Promise<PairingRecord[]> {
    return this.serialize(() => this.read());
  }

  async get(pairId: string): Promise<PairingRecord | null> {
    const records = await this.list();
    return records.find((record) => record.pairId === pairId) ?? null;
  }

  save(record: PairingRecord): Promise<void> {
    const clean = normalizePairingRecord(record);
    if (!clean) return Promise.reject(new InvalidPairingRecordError());
    return this.serialize(async () => {
      const records = await this.read();
      const index = records.findIndex((existing) => existing.pairId === clean.pairId);
      if (index >= 0) {
        records[index] = clean;
      } else {
        records.push(clean);
      }
      await this.write(records);
    });
  }

  remove(pairId: string): Promise<void> {
    return this.serialize(async () => {
      const records = await this.read();
      const remaining = records.filter((record) => record.pairId !== pairId);
      if (remaining.length === records.length) return;
      await this.write(remaining);
    });
  }

  private async read(): Promise<PairingRecord[]> {
    return parsePairingRecords(await this.store.getItem(this.key));
  }

  private async write(records: PairingRecord[]): Promise<void> {
    if (records.length === 0) {
      await this.store.deleteItem(this.key);
    } else {
      await this.store.setItem(this.key, JSON.stringify(records));
    }
  }

  private serialize<T>(task: () => Promise<T>): Promise<T> {
    const result = this.tail.then(task);
    this.tail = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }
}
