import { formatClock, formatDuration, formatKbps, formatLevel, formatMs, formatPercent } from './format';

describe('formatters', () => {
  it('formats bitrates', () => {
    expect(formatKbps(24_000)).toBe('24 kbps');
    expect(formatKbps(23_500)).toBe('23.5 kbps');
    expect(formatKbps(null)).toBe('n/a');
  });

  it('formats milliseconds and percentages', () => {
    expect(formatMs(4)).toBe('4 ms');
    expect(formatMs(3.46)).toBe('3.5 ms');
    expect(formatMs(null)).toBe('n/a');
    expect(formatPercent(0.25)).toBe('0.3 %');
    expect(formatPercent(1.5, 0)).toBe('2 %');
    expect(formatPercent(null)).toBe('n/a');
  });

  it('formats 0..1 levels as clamped whole percents', () => {
    expect(formatLevel(0.424)).toBe('42 %');
    expect(formatLevel(3)).toBe('100 %');
    expect(formatLevel(-1)).toBe('0 %');
    expect(formatLevel(null)).toBe('n/a');
  });

  it('formats durations', () => {
    expect(formatDuration(0)).toBe('0 s');
    expect(formatDuration(59_999)).toBe('59 s');
    expect(formatDuration(125_000)).toBe('2 min 5 s');
    expect(formatDuration(3_725_000)).toBe('1 h 2 min 5 s');
    expect(formatDuration(-5)).toBe('0 s');
  });

  it('formats local clock time with milliseconds', () => {
    const t = new Date(2026, 10, 17, 9, 3, 5, 7).getTime();
    expect(formatClock(t)).toBe('09:03:05.007');
  });
});
