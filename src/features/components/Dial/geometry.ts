/**
 * Dial geometry. Angles are clock angles in degrees: 0 at 12 o'clock, increasing clockwise. Pure functions (unit
 * tested in geometry.test.ts).
 */

export interface Point {
  x: number;
  y: number;
}

export function polar(cx: number, cy: number, r: number, angleDeg: number): Point {
  const a = ((angleDeg - 90) * Math.PI) / 180;
  return { x: cx + r * Math.cos(a), y: cy + r * Math.sin(a) };
}

const f = (n: number) => Math.round(n * 100) / 100;

/** SVG arc path from `startDeg` sweeping clockwise by `sweepDeg` (0 < sweep < 360). */
export function arcPath(cx: number, cy: number, r: number, startDeg: number, sweepDeg: number): string {
  const sweep = Math.max(0.01, Math.min(359.99, sweepDeg));
  const a = polar(cx, cy, r, startDeg);
  const b = polar(cx, cy, r, startDeg + sweep);
  const large = sweep > 180 ? 1 : 0;
  return `M${f(a.x)} ${f(a.y)}A${f(r)} ${f(r)} 0 ${large} 1 ${f(b.x)} ${f(b.y)}`;
}

/** Length of an arc of `sweepDeg` on radius `r`. */
export function arcLength(r: number, sweepDeg: number): number {
  return (Math.PI * r * sweepDeg) / 180;
}

/** One path with `count` radial ticks between r1 and r2, starting at `startDeg`, `stepDeg` apart. */
export function ticksPath(
  cx: number,
  cy: number,
  r1: number,
  r2: number,
  count: number,
  startDeg: number,
  stepDeg: number,
  filter: (index: number) => boolean = () => true,
): string {
  let d = '';
  for (let i = 0; i < count; i++) {
    if (!filter(i)) continue;
    const angle = startDeg + i * stepDeg;
    const a = polar(cx, cy, r1, angle);
    const b = polar(cx, cy, r2, angle);
    d += `M${f(a.x)} ${f(a.y)}L${f(b.x)} ${f(b.y)}`;
  }
  return d;
}

/**
 * Rosette (guilloche) curve: r(t) = R * (1 - depth + depth * cos(petals * t)), closed, rotated by `phaseDeg`.
 */
export function rosettePath(
  cx: number,
  cy: number,
  radius: number,
  petals: number,
  depth: number,
  phaseDeg: number,
  samples = 360,
): string {
  let d = '';
  const phase = (phaseDeg * Math.PI) / 180;
  for (let i = 0; i <= samples; i++) {
    const t = (i / samples) * Math.PI * 2;
    const r = radius * (1 - depth + depth * Math.cos(petals * t));
    const x = cx + r * Math.cos(t + phase);
    const y = cy + r * Math.sin(t + phase);
    d += `${i === 0 ? 'M' : 'L'}${f(x)} ${f(y)}`;
  }
  return `${d}Z`;
}

/** Gauge sweep: 270 degrees from 7:30 to 4:30 through 12. */
export const GAUGE_START = 225;
export const GAUGE_SWEEP = 270;

/** Clock angle of a 0..1 value on the gauge. */
export function gaugeAngle(value: number): number {
  const v = Math.max(0, Math.min(1, value));
  return GAUGE_START + GAUGE_SWEEP * v;
}

/** Ring metrics for a dial of `size`: bezel ring, tick radii and the face radius. */
export function bezelMetrics(size: number) {
  const c = size / 2;
  const R = c - 1;
  const ring = Math.max(8, size * 0.04);
  const tickOuter = R - ring - 4;
  const tickMinor = tickOuter - 5;
  const tickMajor = tickOuter - 10;
  const face = tickMajor - 4;
  return { c, R, ring, tickOuter, tickMinor, tickMajor, face };
}

/** Minimum gap between a sub-dial and the arc band or the pointer, in dp. */
export const GAUGE_CLEARANCE = 6;

/**
 * Ride-gauge layout. The pointer (a ringed triangle riding on the arc) sweeps the band between `pointerInner` and
 * `pointerOuter`; the two sub-dials sit fully inside `pointerInner - GAUGE_CLEARANCE`, so neither the arc nor the
 * pointer can touch them at any value. Sub-dial centres are at clock angles 180 +/- 50 degrees (below 3 and 9).
 */
export function gaugeLayout(size: number) {
  const m = bezelMetrics(size);
  const arcR = m.face - 12;
  const arcStroke = 6;
  const pointerRing = 6.8;
  const pointerTip = 5;
  const pointerTail = 11;
  const pointerInner = arcR - pointerTail;
  const pointerOuter = arcR + Math.max(pointerTip, pointerRing);
  const subR = Math.round(size * 0.094);
  const subDist = pointerInner - GAUGE_CLEARANCE - 2 - subR;
  const angle = 130;
  const left = polar(m.c, m.c, subDist, 360 - angle);
  const right = polar(m.c, m.c, subDist, angle);
  return {
    ...m,
    arcR,
    arcStroke,
    arcLen: arcLength(arcR, GAUGE_SWEEP),
    pointerRing,
    pointerTip,
    pointerTail,
    pointerInner,
    pointerOuter,
    sub: { r: subR, dist: subDist, left, right },
  };
}

/** Average advance of a Marcellus SC capital, in em (measured 0.50-0.64 in Chromium; rounded up). */
export const LEGEND_EM = 0.66;

/** Estimated width of an uppercase engraved legend. */
export function legendWidth(text: string, fontSize: number, trackingPx: number): number {
  const n = text.length;
  return n * fontSize * LEGEND_EM + Math.max(0, n - 1) * trackingPx;
}

/** Width of a horizontal chord of a circle of radius `r` at vertical offset `dy` from its centre. */
export function chordWidth(r: number, dy: number): number {
  return Math.abs(dy) >= r ? 0 : 2 * Math.sqrt(r * r - dy * dy);
}

/**
 * Letter spacing (px) for a legend that must fit in `maxWidth`: the preferred tracking when it fits, less when it
 * does not, and null when even untracked text is too wide (use a shorter word).
 */
export function fitTracking(
  text: string,
  fontSize: number,
  maxWidth: number,
  preferredPx: number,
): number | null {
  if (legendWidth(text, fontSize, 0) > maxWidth) return null;
  if (legendWidth(text, fontSize, preferredPx) <= maxWidth) return preferredPx;
  const gaps = Math.max(1, text.length - 1);
  return Math.max(0, Math.floor(((maxWidth - legendWidth(text, fontSize, 0)) / gaps) * 10) / 10);
}

/** Vertical offset of a sub-dial legend's centre below the dial centre (value line 20 + 1 + legend line 12). */
export const SUBDIAL_LEGEND_DY = 10.5;

/** Horizontal room for a sub-dial legend: the chord inside the rim ticks (rim - 7) at the legend's line. */
export function subDialLegendRoom(size: number, dy: number = SUBDIAL_LEGEND_DY): number {
  return chordWidth(size / 2 - 8, dy);
}
