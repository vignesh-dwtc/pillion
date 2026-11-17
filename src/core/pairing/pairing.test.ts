import { describe, expect, it } from '@jest/globals';
import { encode } from 'uqr';

import { createCryptoProvider } from '../protocol/noble';
import { base64urlDecode, base64urlEncode } from '../protocol/base64url';
import { mulberry32, randomInt, seededRandomBytes, systemRandomBytes } from '../protocol/testing/rng';
import { PAIRING_PREFIX } from './config';
import { PairingError } from './errors';
import type { PairingErrorCode } from './errors';
import { generatePairing } from './generate';
import { createMemoryPairingRepository } from './memoryRepository';
import { MAX_PAIRING_STRING_LENGTH, decodePairingString, encodePairingString } from './payload';
import { payloadFromRecord, recordFromPayload } from './record';
import type { PairingPayload } from './types';
import { validateNetworkName, validatePairingRecord, validatePassphrase } from './validate';

const crypto = createCryptoProvider(seededRandomBytes(7));

function codeOf(fn: () => unknown): PairingErrorCode {
  try {
    fn();
  } catch (error) {
    if (error instanceof PairingError) return error.code;
    throw error;
  }
  throw new Error('expected a PairingError');
}

function sample(): PairingPayload {
  return generatePairing(crypto, '  Alex  ');
}

/** Re-encodes a binary mutation of a valid string. */
function binaryOf(text: string): Uint8Array {
  const body = text.slice(text.indexOf(':') + 1);
  return base64urlDecode(body) as Uint8Array;
}
const withBinary = (bytes: Uint8Array): string => `${PAIRING_PREFIX}1:${base64urlEncode(bytes)}`;

describe('generatePairing', () => {
  it('produces valid, trimmed, correctly sized fields', () => {
    const p = sample();
    expect(p.version).toBe(1);
    expect(p.hostName).toBe('Alex');
    expect(p.secret).toHaveLength(32);
    expect(p.pairId).toHaveLength(22);
    expect(() => validateNetworkName(p.wifiDirect.networkName)).not.toThrow();
    expect(() => validatePassphrase(p.wifiDirect.passphrase)).not.toThrow();
    expect(p.wifiDirect.networkName.startsWith('DIRECT-pn-')).toBe(true);
  });

  it('is unique per call with real randomness', () => {
    const real = createCryptoProvider(systemRandomBytes);
    const a = generatePairing(real, 'A');
    const b = generatePairing(real, 'A');
    expect(a.pairId).not.toBe(b.pairId);
    expect(a.secret).not.toEqual(b.secret);
    expect(a.wifiDirect.passphrase).not.toBe(b.wifiDirect.passphrase);
  });

  it('uses rejection sampling: bytes >= 248 are skipped, no modulo bias', () => {
    const calls: number[] = [];
    let call = 0;
    const scripted = createCryptoProvider((length) => {
      calls.push(length);
      call += 1;
      if (call === 1 || call === 2) return seededRandomBytes(call)(length); // id and secret
      // Alternate a rejected byte (250) and an accepted one (61 -> '9').
      return Uint8Array.from({ length }, (_, i) => (i % 2 === 0 ? 250 : 61));
    });
    const p = generatePairing(scripted, 'Bo');
    expect(p.wifiDirect.networkName).toBe('DIRECT-pn-99999999');
    expect(p.wifiDirect.passphrase).toBe('9'.repeat(24));
  });

  it('draws every alphanumeric character with roughly equal frequency', () => {
    const counts = new Map<string, number>();
    const real = createCryptoProvider(seededRandomBytes(99));
    for (let i = 0; i < 400; i++) {
      for (const ch of generatePairing(real, 'x').wifiDirect.passphrase)
        counts.set(ch, (counts.get(ch) ?? 0) + 1);
    }
    expect(counts.size).toBe(62);
    for (const n of counts.values()) expect(n).toBeGreaterThan(100); // expected about 155
  });

  it('rejects bad host names', () => {
    for (const name of ['', '   ', 'x'.repeat(25), 'a\nb', 'a‮b', '\ud800']) {
      expect(codeOf(() => generatePairing(crypto, name))).toBe('bad-host-name');
    }
    expect(codeOf(() => generatePairing(crypto, 5 as unknown as string))).toBe('bad-host-name');
  });

  it('fails with rng-failure for short, constant or exhausted sources', () => {
    expect(codeOf(() => generatePairing({ ...crypto, randomBytes: () => new Uint8Array(3) }, 'A'))).toBe(
      'rng-failure',
    );
    expect(codeOf(() => generatePairing({ ...crypto, randomBytes: (n) => new Uint8Array(n) }, 'A'))).toBe(
      'rng-failure',
    );
    let call = 0;
    const alwaysRejected = {
      ...crypto,
      randomBytes: (n: number) => (++call <= 2 ? seededRandomBytes(call)(n) : new Uint8Array(n).fill(255)),
    };
    expect(codeOf(() => generatePairing(alwaysRejected, 'A'))).toBe('rng-failure');
  });
});

describe('pairing string', () => {
  it('has the documented shape and round-trips', () => {
    const p = sample();
    const text = encodePairingString(p);
    expect(text.startsWith(`${PAIRING_PREFIX}1:`)).toBe(true);
    expect(text).toMatch(/^[A-Za-z0-9:\-_]+$/);
    expect(decodePairingString(text)).toEqual(p);
  });

  it('round-trips random payloads including non-ASCII names', () => {
    const next = mulberry32(5);
    const names = ['Ünal', '日本語の名前', '🏍️ rider', 'a', 'x'.repeat(24)];
    for (let i = 0; i < 100; i++) {
      const p = generatePairing(crypto, names[i % names.length] as string);
      // vary credential lengths and characters within the legal range
      const suffixLen = randomInt(next, 1, 22);
      const passLen = randomInt(next, 8, 63);
      const chars = (n: number, lo: number, hi: number): string =>
        Array.from({ length: n }, () => String.fromCharCode(randomInt(next, lo, hi))).join('');
      p.wifiDirect = {
        networkName: `DIRECT-aZ-${chars(suffixLen, 0x21, 0x7e)}`.slice(0, 32),
        passphrase: chars(passLen, 0x20, 0x7e),
      };
      expect(decodePairingString(encodePairingString(p))).toEqual(p);
    }
  });

  it('worst case fits QR version <= 12 at error correction M (measured)', () => {
    const p: PairingPayload = {
      ...sample(),
      hostName: '日'.repeat(24), // 24 units, 72 UTF-8 bytes
      wifiDirect: {
        networkName: `DIRECT-aB-${'~'.repeat(22)}`, // 32 bytes
        passphrase: '~'.repeat(63),
      },
    };
    const text = encodePairingString(p);
    const qr = encode(text, { ecc: 'M', border: 0 });
    const version = (qr.size - 17) / 4;
    console.info(`QR worst case: ${text.length} chars, matrix ${qr.size}x${qr.size}, version ${version}`);
    expect(text.length).toBeLessThanOrEqual(MAX_PAIRING_STRING_LENGTH);
    expect(version).toBeLessThanOrEqual(12);
    const typical = encode(encodePairingString(sample()), { ecc: 'M', border: 0 });
    console.info(`QR typical: version ${(typical.size - 17) / 4}`);
    expect(decodePairingString(text)).toEqual(p);
  });

  it('encode validates the payload', () => {
    const p = sample();
    expect(codeOf(() => encodePairingString({ ...p, version: 2 }))).toBe('unsupported-version');
    expect(codeOf(() => encodePairingString({ ...p, pairId: 'short' }))).toBe('bad-pair-id');
    expect(codeOf(() => encodePairingString({ ...p, secret: new Uint8Array(31) }))).toBe('bad-secret');
    expect(codeOf(() => encodePairingString({ ...p, hostName: '' }))).toBe('bad-host-name');
    expect(
      codeOf(() => encodePairingString({ ...p, wifiDirect: { ...p.wifiDirect, networkName: 'x' } })),
    ).toBe('bad-network-name');
    expect(
      codeOf(() => encodePairingString({ ...p, wifiDirect: { ...p.wifiDirect, passphrase: 'short' } })),
    ).toBe('bad-passphrase');
  });

  describe('strict decoding', () => {
    const good = encodePairingString(sample());
    const bin = binaryOf(good);

    it('rejects wrong prefix, format, version, encoding, length', () => {
      expect(codeOf(() => decodePairingString('other1:' + good.slice(8)))).toBe('bad-prefix');
      expect(codeOf(() => decodePairingString(''))).toBe('bad-prefix');
      expect(codeOf(() => decodePairingString(PAIRING_PREFIX + 'x'))).toBe('bad-format');
      expect(codeOf(() => decodePairingString(PAIRING_PREFIX + '1'))).toBe('bad-format');
      expect(codeOf(() => decodePairingString(PAIRING_PREFIX + '01:AAAA'))).toBe('bad-format');
      expect(codeOf(() => decodePairingString(PAIRING_PREFIX + '2:AAAA'))).toBe('unsupported-version');
      expect(codeOf(() => decodePairingString(PAIRING_PREFIX + '1:AA+A'))).toBe('bad-encoding');
      expect(codeOf(() => decodePairingString(PAIRING_PREFIX + '1:AAA='))).toBe('bad-encoding');
      expect(codeOf(() => decodePairingString(good + ' '))).toBe('bad-encoding');
      expect(codeOf(() => decodePairingString(good + 'A'.repeat(500)))).toBe('too-long');
      expect(codeOf(() => decodePairingString(5 as unknown as string))).toBe('bad-format');
    });

    it('rejects every truncation', () => {
      for (let n = 0; n < bin.length; n++) {
        const code = codeOf(() => decodePairingString(withBinary(bin.subarray(0, n))));
        expect(['truncated', 'bad-host-name', 'bad-network-name', 'bad-passphrase']).toContain(code);
      }
    });

    it('rejects trailing data', () => {
      const extra = new Uint8Array(bin.length + 1);
      extra.set(bin);
      expect(codeOf(() => decodePairingString(withBinary(extra)))).toBe('trailing-data');
    });

    it('rejects invalid UTF-8, empty name, bad network name, bad passphrase, non-zero padding', () => {
      const nameLen = bin[48] as number;
      const badUtf8 = bin.slice();
      badUtf8[49] = 0xff;
      expect(codeOf(() => decodePairingString(withBinary(badUtf8)))).toBe('bad-host-name');
      const emptyName = new Uint8Array([...bin.slice(0, 48), 0, ...bin.slice(49 + nameLen)]);
      expect(codeOf(() => decodePairingString(withBinary(emptyName)))).toBe('bad-host-name');
      const badX = bin.slice();
      badX[49 + nameLen] = 0x2d; // '-' is not alphanumeric
      expect(codeOf(() => decodePairingString(withBinary(badX)))).toBe('bad-network-name');
      // A 1-char suffix is 7 bits plus 1 padding bit: set the padding bit.
      const oneChar = new Uint8Array([
        ...bin.slice(0, 51 + nameLen),
        1,
        0x80 | 0x01,
        ...bin.slice(52 + nameLen + 7),
      ]);
      expect(codeOf(() => decodePairingString(withBinary(oneChar)))).toBe('bad-network-name');
      const ctl = new Uint8Array([...bin.slice(0, 51 + nameLen), 1, 0x00, ...bin.slice(52 + nameLen + 7)]);
      expect(codeOf(() => decodePairingString(withBinary(ctl)))).toBe('bad-network-name'); // NUL char
      const shortPass = bin.slice(0, 52 + nameLen + 7);
      expect(codeOf(() => decodePairingString(withBinary(new Uint8Array([...shortPass, 3, 0, 0, 0]))))).toBe(
        'bad-passphrase',
      );
      const padPass = new Uint8Array([...shortPass, 8, 0x41, 0x41, 0x41, 0x41, 0x41, 0x41, 0x41]);
      expect(codeOf(() => decodePairingString(withBinary(padPass)))).toBe('bad-passphrase');
      // 9 chars = 63 bits + 1 padding bit; set the padding bit on a valid passphrase
      const nine = new Uint8Array(8).fill(0x55);
      nine[7] = (nine[7] as number) | 1;
      const nonCanonical = new Uint8Array([...shortPass, 9, ...nine]);
      expect(codeOf(() => decodePairingString(withBinary(nonCanonical)))).toBe('bad-passphrase');
    });

    it('never throws anything but PairingError on random garbage', () => {
      const next = mulberry32(11);
      for (let i = 0; i < 500; i++) {
        const garbage = new Uint8Array(randomInt(next, 0, 220));
        for (let j = 0; j < garbage.length; j++) garbage[j] = randomInt(next, 0, 255);
        codeOf(() => decodePairingString(withBinary(garbage)));
        const mutated = bin.slice();
        mutated[randomInt(next, 0, mutated.length - 1)] = randomInt(next, 0, 255);
        try {
          decodePairingString(withBinary(mutated));
        } catch (error) {
          expect(error).toBeInstanceOf(PairingError);
        }
      }
    });
  });

  it('error messages never contain the secret, passphrase or input', () => {
    const p = sample();
    const secretText = base64urlEncode(p.secret);
    const text = encodePairingString(p);
    const bodies = [
      text.slice(0, -1) + '!',
      text + 'AAAA',
      text.slice(0, 40),
      PAIRING_PREFIX + '9:' + text.slice(9),
    ];
    const errors: PairingError[] = [];
    for (const body of bodies) {
      try {
        decodePairingString(body);
      } catch (e) {
        errors.push(e as PairingError);
      }
    }
    try {
      encodePairingString({ ...p, hostName: '' });
    } catch (e) {
      errors.push(e as PairingError);
    }
    try {
      generatePairing(crypto, 'x'.repeat(30));
    } catch (e) {
      errors.push(e as PairingError);
    }
    expect(errors.length).toBeGreaterThan(3);
    for (const e of errors) {
      const all = `${e.message} ${e.stack ?? ''} ${e.name} ${e.code}`;
      expect(all.includes(secretText)).toBe(false);
      expect(all.includes(p.wifiDirect.passphrase)).toBe(false);
      expect(all.includes(p.pairId)).toBe(false);
    }
  });
});

describe('records and repository', () => {
  const now = 1_700_000_000_000;

  it('host record: no partner name; guest record: host name', () => {
    const p = sample();
    const host = recordFromPayload(p, 'host', now);
    const guest = recordFromPayload(p, 'guest', now);
    expect(host.role).toBe('host');
    expect(host.partnerName).toBeNull();
    expect(guest.role).toBe('guest');
    expect(guest.partnerName).toBe('Alex');
    expect(host.secret).toBe(base64urlEncode(p.secret));
    expect(host.pairId).toBe(p.pairId);
    expect(guest.wifiDirect).toEqual(p.wifiDirect);
    expect(guest.wifiDirect).not.toBe(p.wifiDirect);
    expect(host.createdAt).toBe(now);
  });

  it('payloadFromRecord reproduces the payload', () => {
    const p = sample();
    expect(payloadFromRecord(recordFromPayload(p, 'host', now), p.hostName)).toEqual(p);
  });

  it('validatePairingRecord rejects malformed records', () => {
    const good = recordFromPayload(sample(), 'host', now);
    const bad = (patch: Record<string, unknown>): PairingErrorCode =>
      codeOf(() => validatePairingRecord({ ...good, ...patch }));
    expect(codeOf(() => validatePairingRecord(null))).toBe('bad-record');
    expect(codeOf(() => validatePairingRecord([]))).toBe('bad-record');
    expect(bad({ pairId: 'x' })).toBe('bad-pair-id');
    expect(bad({ secret: 'x' })).toBe('bad-secret');
    expect(bad({ role: 'admin' })).toBe('bad-record');
    expect(bad({ partnerName: 5 })).toBe('bad-record');
    expect(bad({ createdAt: -1 })).toBe('bad-record');
    expect(bad({ createdAt: NaN })).toBe('bad-record');
    expect(bad({ wifiDirect: null })).toBe('bad-network-name');
    expect(bad({ wifiDirect: { networkName: good.wifiDirect.networkName, passphrase: 'a' } })).toBe(
      'bad-passphrase',
    );
  });

  it('stores, lists, gets, removes, and isolates copies', async () => {
    const repo = createMemoryPairingRepository();
    expect(await repo.list()).toEqual([]);
    const a = recordFromPayload(sample(), 'host', now);
    const b = recordFromPayload(generatePairing(crypto, 'Bea'), 'guest', now + 1);
    await repo.save(a);
    await repo.save(b);
    expect(await repo.list()).toHaveLength(2);
    const got = await repo.get(a.pairId);
    expect(got).toEqual(a);
    (got as { partnerName: string | null }).partnerName = 'mutated';
    expect((await repo.get(a.pairId))?.partnerName).toBeNull();
    await repo.save({ ...a, partnerName: 'Casey' });
    expect((await repo.get(a.pairId))?.partnerName).toBe('Casey');
    expect(await repo.list()).toHaveLength(2);
    await repo.remove(a.pairId);
    expect(await repo.get(a.pairId)).toBeNull();
    await repo.remove(a.pairId); // idempotent
    expect(await repo.list()).toEqual([b]);
    expect(await repo.get('unknown')).toBeNull();
  });

  it('rejects invalid input through the promise, not synchronously', async () => {
    const repo = createMemoryPairingRepository();
    await expect(repo.save({ pairId: 'x' } as never)).rejects.toBeInstanceOf(PairingError);
    await expect(repo.remove('x')).rejects.toBeInstanceOf(PairingError);
  });
});
