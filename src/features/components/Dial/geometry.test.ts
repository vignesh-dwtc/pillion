import { arcLength, arcPath, gaugeAngle, polar, rosettePath, ticksPath } from './geometry';

describe('dial geometry', () => {
  it('uses clock angles: 0 is 12 o clock, 90 is 3 o clock', () => {
    const top = polar(0, 0, 10, 0);
    expect(top.x).toBeCloseTo(0, 5);
    expect(top.y).toBeCloseTo(-10, 5);
    const right = polar(0, 0, 10, 90);
    expect(right.x).toBeCloseTo(10, 5);
    expect(right.y).toBeCloseTo(0, 5);
  });

  it('draws the large-arc flag only past 180 degrees', () => {
    expect(arcPath(50, 50, 40, 0, 90)).toContain(' 0 0 1 ');
    expect(arcPath(50, 50, 40, 225, 270)).toContain(' 0 1 1 ');
  });

  it('measures arcs', () => {
    expect(arcLength(10, 180)).toBeCloseTo(Math.PI * 10, 5);
  });

  it('maps gauge values to 7:30 .. 4:30 and clamps', () => {
    expect(gaugeAngle(0)).toBe(225);
    expect(gaugeAngle(1)).toBe(495);
    expect(gaugeAngle(2)).toBe(495);
    expect(gaugeAngle(-1)).toBe(225);
  });

  it('builds one segment per kept tick and closed rosettes', () => {
    const d = ticksPath(0, 0, 10, 12, 60, 0, 6, (i) => i % 5 === 0);
    expect(d.match(/M/g)).toHaveLength(12);
    const rosette = rosettePath(0, 0, 10, 12, 0.2, 0, 36);
    expect(rosette.endsWith('Z')).toBe(true);
  });
});
