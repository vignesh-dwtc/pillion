import { encode } from 'uqr';

/**
 * QR model for the pairing screen: pure TypeScript on top of `uqr`, so Jest can test the geometry and the screen
 * only has to draw one SVG path. Dark modules are merged into horizontal runs (one `M..h..v1h..z` per run).
 */

export interface QrModel {
  /** Modules per side, without the quiet zone. */
  size: number;
  /** Quiet zone in modules (the QR spec asks for 4). */
  quietZone: number;
  /** Side of the square viewBox: size plus a quiet zone on both sides. */
  viewBoxSize: number;
  /** SVG path data of every dark module, in viewBox coordinates. */
  path: string;
}

export const QR_QUIET_ZONE = 4;

export function matrixToPath(matrix: readonly (readonly boolean[])[], offset: number): string {
  const commands: string[] = [];
  matrix.forEach((row, y) => {
    let x = 0;
    while (x < row.length) {
      if (!row[x]) {
        x += 1;
        continue;
      }
      const start = x;
      while (x < row.length && row[x]) x += 1;
      const length = x - start;
      commands.push(`M${start + offset} ${y + offset}h${length}v1h-${length}z`);
    }
  });
  return commands.join('');
}

export function buildQrModel(data: string, quietZone: number = QR_QUIET_ZONE): QrModel {
  const result = encode(data, { ecc: 'M', border: 0 });
  return {
    size: result.size,
    quietZone,
    viewBoxSize: result.size + quietZone * 2,
    path: matrixToPath(result.data, quietZone),
  };
}
