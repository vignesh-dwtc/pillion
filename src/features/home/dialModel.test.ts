import { dialPair, formatSince, initialOf, primaryPairing } from './dialModel';

describe('home dial model', () => {
  it('formats the pairing date', () => {
    expect(formatSince(new Date(2026, 10, 17).getTime())).toBe('17 Nov 2026');
  });

  it('takes initials safely', () => {
    expect(initialOf('meera')).toBe('M');
    expect(initialOf('  ')).toBe('?');
    expect(initialOf(null)).toBe('?');
  });

  it('puts the host on the rider side', () => {
    const base = { pairId: 'p', partnerName: 'Meera', createdAt: 0 };
    expect(dialPair({ ...base, role: 'host' }, 'Arjun', 'partner')).toMatchObject({
      riderInitial: 'A',
      pillionInitial: 'M',
      partner: 'Meera',
    });
    expect(dialPair({ ...base, role: 'guest' }, 'Arjun', 'partner')).toMatchObject({
      riderInitial: 'M',
      pillionInitial: 'A',
    });
  });

  it('picks the most recent pairing, or none', () => {
    expect(primaryPairing([])).toBeNull();
    const older = { pairId: 'a', role: 'guest' as const, partnerName: 'Old', createdAt: 1 };
    const newer = { pairId: 'b', role: 'host' as const, partnerName: null, createdAt: 2 };
    expect(primaryPairing([older, newer])?.pairId).toBe('b');
    expect(primaryPairing([newer, older])?.pairId).toBe('b');
  });
});
