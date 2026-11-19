import { createMemoryPairingRepository, decodePairingString, encodePairingString } from '../core/pairing';
import type { PairingRecord, PairingRepository } from '../core/pairing/types';
import { createCryptoProvider } from '../core/protocol/noble';
import { seededRandomBytes } from '../core/protocol/testing/rng';
import { PAIRING_PREFIX } from '../core/pairing/config';
import { base64urlEncode } from '../core/protocol/base64url';

import { createPairingService, createScanGate, pairingHostName, type PairingService } from './pairing';

function setup(options: { seed?: number; repository?: PairingRepository } = {}) {
  const repository = options.repository ?? createMemoryPairingRepository();
  let clock = 1_763_000_000_000;
  const changes: number[] = [];
  const service = createPairingService({
    repository,
    crypto: createCryptoProvider(seededRandomBytes(options.seed ?? 7)),
    now: () => (clock += 1000),
    onChanged: () => {
      changes.push(clock);
    },
  });
  return { service, repository, changes };
}

/** A real host offer from a second phone (its own repository and random source). */
async function codeFromAnotherPhone(name = 'Alex', seed = 99): Promise<string> {
  return (await setup({ seed }).service.hostOffer(name)).pairingString;
}

describe('pairingHostName', () => {
  it('keeps a normal name', () => {
    expect(pairingHostName('  Alex  ', 'My phone')).toBe('Alex');
  });

  it('drops control and bidi characters', () => {
    expect(pairingHostName('Al\u0007ex‮', 'My phone')).toBe('Alex');
  });

  it('cuts to 24 UTF-16 units without splitting an emoji', () => {
    const name = pairingHostName('\u{1F3CD}'.repeat(13), 'My phone');
    expect(name.length).toBe(24);
    expect(Array.from(name)).toHaveLength(12);
  });

  it('falls back when nothing usable is left', () => {
    expect(pairingHostName(' \u0001 ', 'My phone')).toBe('My phone');
  });
});

describe('PairingService: host', () => {
  it('generates, saves a host record and returns a decodable pairing string', async () => {
    const { service, repository, changes } = setup();
    const offer = await service.hostOffer('Robin');

    expect(offer.reused).toBe(false);
    expect(offer.hostName).toBe('Robin');
    expect(offer.pairingString.startsWith(PAIRING_PREFIX)).toBe(true);
    const decoded = decodePairingString(offer.pairingString);
    expect(decoded.hostName).toBe('Robin');
    expect(decoded.pairId).toBe(offer.pairId);

    const records = await repository.list();
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({ pairId: offer.pairId, role: 'host', partnerName: null });
    expect(records[0]?.secret).toBe(base64urlEncode(decoded.secret));
    expect(changes).toHaveLength(1);
  });

  it('reuses the unused offer on the next open, with the current name', async () => {
    const { service, repository, changes } = setup();
    const first = await service.hostOffer('Robin');
    const second = await service.hostOffer('Robin R');

    expect(second.reused).toBe(true);
    expect(second.pairId).toBe(first.pairId);
    expect(decodePairingString(second.pairingString).hostName).toBe('Robin R');
    expect(decodePairingString(second.pairingString).secret).toEqual(
      decodePairingString(first.pairingString).secret,
    );
    expect(await repository.list()).toHaveLength(1);
    expect(changes).toHaveLength(1);
  });

  it('does not reuse a host pairing that already knows its partner', async () => {
    const { service, repository } = setup();
    const first = await service.hostOffer('Robin');
    const used = (await repository.get(first.pairId)) as PairingRecord;
    await repository.save({ ...used, partnerName: 'Sam' });

    const next = await service.hostOffer('Robin');
    expect(next.reused).toBe(false);
    expect(next.pairId).not.toBe(first.pairId);
    expect((await repository.list()).map((r) => r.pairId).sort()).toEqual([first.pairId, next.pairId].sort());
  });

  it('regenerates: a new secret replaces the unused offer, other pairings stay', async () => {
    const { service, repository, changes } = setup();
    const guestCode = await codeFromAnotherPhone();
    await service.acceptPairingString(guestCode);
    const first = await service.hostOffer('Robin');
    const fresh = await service.regenerateOffer('Robin');

    expect(fresh.reused).toBe(false);
    expect(fresh.pairId).not.toBe(first.pairId);
    expect(decodePairingString(fresh.pairingString).secret).not.toEqual(
      decodePairingString(first.pairingString).secret,
    );
    const records = await repository.list();
    expect(records.map((r) => r.role).sort()).toEqual(['guest', 'host']);
    expect(records.find((r) => r.role === 'host')?.pairId).toBe(fresh.pairId);
    expect(await repository.get(first.pairId)).toBeNull();
    expect(changes.length).toBeGreaterThanOrEqual(3);
  });

  it('serialises concurrent opens so only one offer is created', async () => {
    const { service, repository } = setup();
    const [a, b] = await Promise.all([service.hostOffer('Robin'), service.hostOffer('Robin')]);
    expect(a.pairId).toBe(b.pairId);
    expect(await repository.list()).toHaveLength(1);
  });

  it('rejects an invalid host name without saving', async () => {
    const { service, repository } = setup();
    await expect(service.hostOffer('')).rejects.toThrow();
    expect(await repository.list()).toEqual([]);
  });
});

describe('PairingService: guest', () => {
  it('saves a guest record from a scanned host code, partner name from the QR', async () => {
    const code = await codeFromAnotherPhone('Alex');
    const { service, repository, changes } = setup();
    const result = await service.acceptPairingString(code);

    expect(result).toEqual({
      ok: true,
      pairId: decodePairingString(code).pairId,
      partnerName: 'Alex',
      alreadyPaired: false,
    });
    const records = await repository.list();
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({ role: 'guest', partnerName: 'Alex' });
    expect(records[0]?.wifiDirect).toEqual(decodePairingString(code).wifiDirect);
    expect(changes).toHaveLength(1);
  });

  it('accepts surrounding whitespace from a paste', async () => {
    const code = await codeFromAnotherPhone();
    const { service } = setup();
    expect((await service.acceptPairingString(`\n  ${code}  \n`)).ok).toBe(true);
  });

  it('is idempotent for the same code (a second scan reports already paired)', async () => {
    const code = await codeFromAnotherPhone();
    const { service, repository } = setup();
    await service.acceptPairingString(code);
    const again = await service.acceptPairingString(code);
    expect(again).toMatchObject({ ok: true, alreadyPaired: true });
    expect(await repository.list()).toHaveLength(1);
  });

  it.each([
    ['another app or a URL', 'https://example.com/hello', 'not-a-pairing-code'],
    ['empty text', '', 'not-a-pairing-code'],
    ['our prefix, malformed version', `${PAIRING_PREFIX}x:abc`, 'not-a-pairing-code'],
    ['a newer version', `${PAIRING_PREFIX}9:AAAA`, 'unsupported-version'],
    ['our prefix, broken data', `${PAIRING_PREFIX}1:@@@`, 'damaged'],
    ['far too long', `${PAIRING_PREFIX}1:${'A'.repeat(1000)}`, 'not-a-pairing-code'],
  ])('rejects %s without saving', async (_label, text, expected) => {
    const { service, repository, changes } = setup();
    expect(await service.acceptPairingString(text)).toEqual({ ok: false, error: expected });
    expect(await repository.list()).toEqual([]);
    expect(changes).toHaveLength(0);
  });

  it('rejects a truncated real code as damaged', async () => {
    const code = await codeFromAnotherPhone();
    const { service } = setup();
    expect(await service.acceptPairingString(code.slice(0, -6))).toEqual({ ok: false, error: 'damaged' });
  });

  it("refuses this phone's own code", async () => {
    const { service, repository } = setup();
    const offer = await service.hostOffer('Robin');
    expect(await service.acceptPairingString(offer.pairingString)).toEqual({ ok: false, error: 'own-code' });
    expect((await repository.list()).map((r) => r.role)).toEqual(['host']);
  });

  it('reports a storage failure as a fixed kind without leaking the code', async () => {
    const code = await codeFromAnotherPhone();
    const failing: PairingRepository = {
      list: () => Promise.resolve([]),
      get: () => Promise.resolve(null),
      save: () => Promise.reject(new Error(`disk full ${code}`)),
      remove: () => Promise.resolve(),
    };
    const { service } = setup({ repository: failing });
    const result = await service.acceptPairingString(code);
    expect(result).toEqual({ ok: false, error: 'storage' });
    expect(JSON.stringify(result)).not.toContain(code.slice(PAIRING_PREFIX.length + 2, 40));
  });

  it('never puts the code into a result or a thrown error', async () => {
    const code = await codeFromAnotherPhone();
    const { service } = setup();
    const results = await Promise.all([
      service.acceptPairingString(code.slice(0, -3)),
      service.acceptPairingString(`${code}AA`),
    ]);
    const secretPart = code.slice(code.indexOf(':') + 1, code.indexOf(':') + 40);
    for (const result of results) expect(JSON.stringify(result)).not.toContain(secretPart);
  });
});

describe('createScanGate', () => {
  function gate(repeatMs = 3000) {
    let now = 0;
    const g = createScanGate({ now: () => now, repeatMs });
    return { g, advance: (ms: number) => (now += ms) };
  }

  it('ignores every scan while one is being handled', () => {
    const { g } = gate();
    expect(g.tryEnter('a')).toBe(true);
    expect(g.tryEnter('a')).toBe(false);
    expect(g.tryEnter('b')).toBe(false);
  });

  it('ignores the same rejected code for the repeat window after release, then allows it again', () => {
    const { g, advance } = gate(3000);
    expect(g.tryEnter('bad')).toBe(true);
    g.release();
    advance(2999);
    expect(g.tryEnter('bad')).toBe(false);
    advance(1);
    expect(g.tryEnter('bad')).toBe(true);
  });

  it('handles a different code right after a release', () => {
    const { g } = gate();
    expect(g.tryEnter('bad')).toBe(true);
    g.release();
    expect(g.tryEnter('good')).toBe(true);
  });

  it('a burst of duplicate scans of a valid code saves one record', async () => {
    const code = await codeFromAnotherPhone();
    const { service, repository } = setup();
    const { g } = gate();
    const handled: Promise<unknown>[] = [];
    for (let i = 0; i < 20; i++) {
      if (g.tryEnter(code)) handled.push(service.acceptPairingString(code));
    }
    expect(handled).toHaveLength(1);
    await Promise.all(handled);
    expect(await repository.list()).toHaveLength(1);
  });
});

describe('round trip between two phones', () => {
  async function pair(host: PairingService, guest: PairingService) {
    const offer = await host.hostOffer('Robin');
    return { offer, result: await guest.acceptPairingString(offer.pairingString) };
  }

  it('host and guest end up with the same pairId, secret and Wi-Fi credentials', async () => {
    const host = setup({ seed: 1 });
    const guest = setup({ seed: 2 });
    const { offer, result } = await pair(host.service, guest.service);
    expect(result).toMatchObject({ ok: true, partnerName: 'Robin' });
    const [h] = await host.repository.list();
    const [g] = await guest.repository.list();
    expect(g?.pairId).toBe(h?.pairId);
    expect(g?.secret).toBe(h?.secret);
    expect(g?.wifiDirect).toEqual(h?.wifiDirect);
    expect(encodePairingString(decodePairingString(offer.pairingString))).toBe(offer.pairingString);
  });
});
