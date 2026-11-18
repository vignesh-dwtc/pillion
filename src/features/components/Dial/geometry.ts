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
