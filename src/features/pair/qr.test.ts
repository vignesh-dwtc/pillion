import { encodePairingString, generatePairing } from '../../core/pairing';
import { createCryptoProvider } from '../../core/protocol/noble';
import { seededRandomBytes } from '../../core/protocol/testing/rng';

import { buildQrModel, matrixToPath, QR_QUIET_ZONE } from './qr';

/** A real pairing string with the longest host name the payload allows (24 three-byte characters). */
const WORST_CASE = encodePairingString(
  generatePairing(createCryptoProvider(seededRandomBytes(3)), '\u6F22'.repeat(24)),
);

describe('matrixToPath', () => {
  it('merges horizontal runs and offsets by the quiet zone', () => {
    const matrix = [
      [true, true, false, true],
      [false, false, false, false],
      [true, false, true, true],
    ];
    expect(matrixToPath(matrix, 0)).toBe('M0 0h2v1h-2zM3 0h1v1h-1zM0 2h1v1h-1zM2 2h2v1h-2z');
    expect(matrixToPath(matrix, 4).startsWith('M4 4h2v1h-2z')).toBe(true);
  });

  it('is empty for an all-light matrix', () => {
    expect(matrixToPath([[false, false]], 2)).toBe('');
  });
});

describe('buildQrModel', () => {
  it('keeps the 4-module quiet zone on every side', () => {
    const model = buildQrModel('hello');
    expect(model.quietZone).toBe(QR_QUIET_ZONE);
    expect(model.viewBoxSize).toBe(model.size + 2 * QR_QUIET_ZONE);
  });

  it('draws only inside the symbol: no dark module touches the quiet zone', () => {
    const model = buildQrModel('hello');
    const coordinates = [...model.path.matchAll(/M(\d+) (\d+)h(\d+)v1/g)].map((m) => ({
      x: Number(m[1]),
      y: Number(m[2]),
      length: Number(m[3]),
    }));
    expect(coordinates.length).toBeGreaterThan(0);
    for (const c of coordinates) {
      expect(c.x).toBeGreaterThanOrEqual(model.quietZone);
      expect(c.y).toBeGreaterThanOrEqual(model.quietZone);
      expect(c.x + c.length).toBeLessThanOrEqual(model.quietZone + model.size);
      expect(c.y).toBeLessThan(model.quietZone + model.size);
    }
  });

  it('has the three finder patterns: a dark ring around a dark centre at three corners', () => {
    const model = buildQrModel('hello', 0);
    const dark = new Set<string>();
    for (const m of model.path.matchAll(/M(\d+) (\d+)h(\d+)v1/g)) {
      for (let i = 0; i < Number(m[3]); i += 1) dark.add(`${Number(m[1]) + i},${m[2]}`);
    }
    const isDark = (x: number, y: number) => dark.has(`${x},${y}`);
    const last = model.size - 1;
    for (const [ox, oy] of [
      [0, 0],
      [last - 6, 0],
      [0, last - 6],
    ] as const) {
      expect(isDark(ox, oy)).toBe(true); // outer ring corner
      expect(isDark(ox + 6, oy + 6)).toBe(true);
      expect(isDark(ox + 1, oy + 1)).toBe(false); // light gap
      expect(isDark(ox + 3, oy + 3)).toBe(true); // centre
    }
  });

  it('is deterministic', () => {
    expect(buildQrModel(WORST_CASE)).toEqual(buildQrModel(WORST_CASE));
  });

  it('scales with the payload (a realistic length needs a larger symbol than a short one)', () => {
    expect(buildQrModel(WORST_CASE).size).toBeGreaterThan(buildQrModel('hi').size);
  });

  it('fits the worst-case real pairing string in QR version 12 at ECC M (65 modules)', () => {
    expect(buildQrModel(WORST_CASE).size).toBeLessThanOrEqual(17 + 4 * 12);
  });
});
