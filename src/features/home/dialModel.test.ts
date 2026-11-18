import { dialPair, formatSince, initialOf } from './dialModel';

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
});
