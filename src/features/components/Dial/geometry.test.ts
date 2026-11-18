import { strings } from '../../../app/strings';

import {
  GAUGE_CLEARANCE,
  GAUGE_START,
  GAUGE_SWEEP,
  arcLength,
  arcPath,
  chordWidth,
  fitTracking,
  gaugeAngle,
  gaugeLayout,
  legendWidth,
  polar,
  rosettePath,
  subDialLegendRoom,
  ticksPath,
} from './geometry';

/** Distance from point p to the segment a-b. */
function segmentDistance(
  p: { x: number; y: number },
  a: { x: number; y: number },
  b: { x: number; y: number },
): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / (dx * dx + dy * dy)));
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

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

  describe('ride gauge layout', () => {
    // 340 is the Pixel 7 gauge, 316 a 360 dp phone, 296 the narrowest supported phone (340 dp).
    const sizes = [296, 316, 340];

    it.each(sizes)('keeps both sub-dials clear of the arc band at %i dp', (size) => {
      const g = gaugeLayout(size);
      const bandInner = g.arcR - g.arcStroke / 2;
      for (const centre of [g.sub.left, g.sub.right]) {
        // Closest approach of the sub-dial circle to the arc band (a ring around the gauge centre).
        const fromCentre = Math.hypot(centre.x - g.c, centre.y - g.c);
        expect(bandInner - (fromCentre + g.sub.r)).toBeGreaterThanOrEqual(GAUGE_CLEARANCE);
      }
    });

    it.each(sizes)('keeps both sub-dials clear of the pointer at every value at %i dp', (size) => {
      const g = gaugeLayout(size);
      for (let step = 0; step <= 270; step++) {
        const angle = GAUGE_START + (GAUGE_SWEEP * step) / 270;
        const ring = polar(g.c, g.c, g.arcR, angle);
        const tail = polar(g.c, g.c, g.pointerInner, angle);
        const tip = polar(g.c, g.c, g.arcR + g.pointerTip, angle);
        for (const centre of [g.sub.left, g.sub.right]) {
          const toRing = Math.hypot(centre.x - ring.x, centre.y - ring.y) - g.pointerRing;
          const toNeedle = segmentDistance(centre, tail, tip);
          expect(Math.min(toRing, toNeedle) - g.sub.r).toBeGreaterThanOrEqual(GAUGE_CLEARANCE);
        }
      }
    });

    it('keeps the sub-dials apart and below the ride time', () => {
      const g = gaugeLayout(340);
      expect(g.sub.right.x - g.sub.left.x).toBeGreaterThan(2 * g.sub.r + 24);
      expect(g.sub.left.y - g.sub.r).toBeGreaterThan(g.c + 12);
    });

    it.each(sizes)('fits the sub-dial legends inside the rim ticks at %i dp', (size) => {
      const g = gaugeLayout(size);
      const room = subDialLegendRoom(g.sub.r * 2);
      for (const legend of [strings.ride.delayLegend, strings.ride.batteryLegend]) {
        const tracking = fitTracking(legend.toUpperCase(), 10, room, 1.8);
        expect(tracking).not.toBeNull();
        expect(legendWidth(legend.toUpperCase(), 10, tracking ?? 0)).toBeLessThanOrEqual(room);
      }
    });
  });

  describe('legend fitting', () => {
    it('measures chords and keeps the preferred tracking when it fits', () => {
      expect(chordWidth(10, 0)).toBeCloseTo(20, 5);
      expect(chordWidth(10, 10)).toBe(0);
      expect(fitTracking('DELAY', 10, 200, 1.8)).toBe(1.8);
    });

    it('tightens tracking, then gives up when the word is too long', () => {
      const tight = fitTracking('PILLION', 10, 50, 1.8);
      expect(tight).not.toBeNull();
      expect(tight!).toBeLessThan(1.8);
      expect(legendWidth('PILLION', 10, tight!)).toBeLessThanOrEqual(50);
      expect(fitTracking('BATTERY', 10, 30, 1.8)).toBeNull();
    });
  });
});
