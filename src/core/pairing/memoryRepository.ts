import type { PairingRecord, PairingRepository } from './types';
import { validatePairId, validatePairingRecord } from './validate';

/** In-memory PairingRepository for tests and the web dev target. Stores validated copies, returns fresh copies. */
export class MemoryPairingRepository implements PairingRepository {
  private readonly records = new Map<string, PairingRecord>();

  list(): Promise<PairingRecord[]> {
    return Promise.resolve([...this.records.values()].map(clone));
  }

  get(pairId: string): Promise<PairingRecord | null> {
    const found = this.records.get(pairId);
    return Promise.resolve(found === undefined ? null : clone(found));
  }

  save(record: PairingRecord): Promise<void> {
    try {
      const valid = validatePairingRecord(record);
      this.records.set(valid.pairId, valid);
      return Promise.resolve();
    } catch (error) {
      return Promise.reject(error);
    }
  }

  remove(pairId: string): Promise<void> {
    try {
      this.records.delete(validatePairId(pairId));
      return Promise.resolve();
    } catch (error) {
      return Promise.reject(error);
    }
  }
}

function clone(record: PairingRecord): PairingRecord {
  return { ...record, wifiDirect: { ...record.wifiDirect } };
}

export function createMemoryPairingRepository(): PairingRepository {
  return new MemoryPairingRepository();
}
