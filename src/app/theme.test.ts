import {
  INTERACTIVE_TEXT_MIN,
  STATUS_TEXT_MIN,
  TEXT_FLOOR,
  colors,
  contrastRatio,
  hit,
  maxFontScale,
  relativeLuminance,
  spacing,
  toneColor,
  tracking,
  type,
} from './theme';

const SURFACES = [colors.bg, colors.surface, colors.surfaceRaised] as const;

describe('contrast helpers', () => {
  it('matches the known WCAG reference values', () => {
    expect(contrastRatio('#000000', '#FFFFFF')).toBeCloseTo(21, 5);
    expect(contrastRatio('#FFFFFF', '#FFFFFF')).toBeCloseTo(1, 5);
    // #767676 on white is the classic "just passes AA (4.54:1)" grey.
    expect(contrastRatio('#767676', '#FFFFFF')).toBeGreaterThan(4.5);
    expect(contrastRatio('#777777', '#FFFFFF')).toBeLessThan(4.6);
    expect(relativeLuminance('#000000')).toBe(0);
  });

  it('rejects malformed colours', () => {
    expect(() => contrastRatio('red', '#000000')).toThrow();
  });
});

describe('palette contrast (WCAG 2.2)', () => {
  it('has no pure black and no saturated green primary', () => {
    for (const value of Object.values(colors)) {
      expect(value.toUpperCase()).not.toBe('#000000');
    }
    expect(colors).not.toHaveProperty('primary');
  });

  it('ivory text is AAA (>= 14:1 in practice, asserted >= 7:1) on every surface', () => {
    for (const surface of SURFACES) {
      expect(contrastRatio(colors.text, surface)).toBeGreaterThanOrEqual(14);
      expect(contrastRatio(colors.textMuted, surface)).toBeGreaterThanOrEqual(8.5);
    }
  });

  it('subtle text (legends, captions, version label) is >= 5.5:1 on every surface', () => {
    for (const surface of SURFACES) {
      expect(contrastRatio(colors.textSubtle, surface)).toBeGreaterThanOrEqual(5.5);
    }
  });

  it('status colours are AAA (>= 7:1) on every surface they are drawn on', () => {
    for (const tone of Object.keys(toneColor) as (keyof typeof toneColor)[]) {
      for (const surface of SURFACES) {
        expect(contrastRatio(toneColor[tone], surface)).toBeGreaterThanOrEqual(7);
      }
    }
    expect(contrastRatio(colors.patina, colors.bg)).toBeGreaterThanOrEqual(10);
    expect(contrastRatio(colors.amber, colors.bg)).toBeGreaterThanOrEqual(10);
    expect(contrastRatio(colors.vermilion, colors.bg)).toBeGreaterThanOrEqual(7.6);
    expect(contrastRatio(colors.brass, colors.bg)).toBeGreaterThanOrEqual(9);
  });

  it('labels on filled plates keep their contrast', () => {
    expect(contrastRatio(colors.onBrass, colors.brass)).toBeGreaterThanOrEqual(8.5);
    expect(contrastRatio(colors.onBrass, colors.brassDeep)).toBeGreaterThanOrEqual(6);
    expect(contrastRatio(colors.onBrass, colors.brassLight)).toBeGreaterThanOrEqual(7);
    // End ride: ivory on the whole oxblood gradient.
    for (const fill of [colors.oxblood, colors.oxbloodTop, colors.oxbloodBottom]) {
      expect(contrastRatio(colors.text, fill)).toBeGreaterThanOrEqual(6.2);
    }
    // Mute: brass label on the dark plate, amber when muted.
    expect(contrastRatio(colors.brass, colors.muteFill)).toBeGreaterThanOrEqual(7.5);
    expect(contrastRatio(colors.amber, colors.muteFill)).toBeGreaterThanOrEqual(7);
    expect(contrastRatio(colors.text, colors.muteFill)).toBeGreaterThanOrEqual(7);
  });

  it('the pairing plate keeps scanner-grade QR contrast and a legible caption', () => {
    expect(contrastRatio(colors.qrDark, colors.qrLight)).toBeGreaterThanOrEqual(16);
    expect(contrastRatio(colors.onBrass, colors.enamel)).toBeGreaterThanOrEqual(16);
    expect(contrastRatio(colors.enamelCaption, colors.enamel)).toBeGreaterThanOrEqual(6.5);
  });

  it('non-text: component boundaries and control fills are >= 3:1 against the surfaces they sit on', () => {
    for (const surface of SURFACES) {
      expect(contrastRatio(colors.border, surface)).toBeGreaterThanOrEqual(3);
      expect(contrastRatio(colors.brass, surface)).toBeGreaterThanOrEqual(3);
      expect(contrastRatio(colors.amber, surface)).toBeGreaterThanOrEqual(3);
    }
    expect(contrastRatio(colors.brassDeep, colors.bg)).toBeGreaterThanOrEqual(3);
    expect(contrastRatio(colors.brassLight, colors.surface)).toBeGreaterThanOrEqual(3);
    // The oxblood plate is not a boundary on its own: its label and its brass-free frame carry it. Its outline is
    // the ivory label plus the stroke drawn in `border`, which is >= 3:1 on bg (above).
  });

  it('decorative tones stay quiet (they must never be mistaken for a boundary)', () => {
    expect(contrastRatio(colors.hairline, colors.bg)).toBeLessThan(3);
    expect(contrastRatio(colors.brassShadow, colors.bg)).toBeLessThan(3.5);
  });
});

describe('sizes', () => {
  it('touch targets: >= 48 everywhere, 56 rows, 76 primary, >= 96 ride controls', () => {
    expect(hit.min).toBeGreaterThanOrEqual(48);
    expect(hit.row).toBeGreaterThanOrEqual(56);
    expect(hit.control).toBeGreaterThanOrEqual(56);
    expect(hit.primary).toBeGreaterThanOrEqual(76);
    expect(hit.rideMin).toBeGreaterThanOrEqual(96);
    expect(hit.rideHeight).toBeGreaterThanOrEqual(hit.rideMin);
  });

  it('type floors: nothing below 10, interactive text >= 15, status >= 13, line height above size', () => {
    for (const variant of Object.values(type)) {
      expect(variant.fontSize).toBeGreaterThanOrEqual(TEXT_FLOOR);
      expect(variant.lineHeight).toBeGreaterThan(variant.fontSize);
    }
    for (const interactive of [type.button, type.plateLabel, type.bodyLarge, type.body, type.value]) {
      expect(interactive.fontSize).toBeGreaterThanOrEqual(INTERACTIVE_TEXT_MIN);
    }
    expect(type.caption.fontSize).toBeGreaterThanOrEqual(STATUS_TEXT_MIN);
    expect(type.partnerScriptRow.fontSize).toBeGreaterThanOrEqual(20);
  });

  it('the scale is smaller than the old one (40/30/22/20/18)', () => {
    expect(type.display.fontSize).toBeLessThanOrEqual(28);
    expect(type.title.fontSize).toBeLessThanOrEqual(24);
    expect(type.body.fontSize).toBeLessThanOrEqual(16);
  });

  it('every type variant has a font scale cap and only the decorative dial legend is fixed', () => {
    for (const variant of Object.keys(type) as (keyof typeof type)[]) {
      expect(maxFontScale[variant]).toBeGreaterThanOrEqual(variant === 'dialLegend' ? 1 : 1.15);
    }
    for (const variant of ['bodyLarge', 'body', 'caption', 'value'] as const) {
      expect(maxFontScale[variant]).toBeGreaterThanOrEqual(1.6);
    }
  });

  it('tracking converts em to dp', () => {
    expect(tracking(12, 0.2)).toBeCloseTo(2.4, 5);
    expect(type.legend.letterSpacing).toBeCloseTo(2.4, 5);
  });

  it('the spacing scale is strictly increasing', () => {
    const values = Object.values(spacing);
    expect([...values].sort((a, b) => a - b)).toEqual(values);
    expect(new Set(values).size).toBe(values.length);
  });
});
