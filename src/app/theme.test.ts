import {
  colors,
  contrastRatio,
  hit,
  maxFontScale,
  relativeLuminance,
  spacing,
  toneColor,
  type,
} from './theme';

const SURFACES = [colors.bg, colors.surface, colors.surfaceRaised, colors.surfaceSelected] as const;

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
  it('primary text is AAA (>= 7:1) on every surface', () => {
    for (const surface of SURFACES) {
      expect(contrastRatio(colors.text, surface)).toBeGreaterThanOrEqual(7);
      expect(contrastRatio(colors.textMuted, surface)).toBeGreaterThanOrEqual(7);
    }
  });

  it('subtle text is at least AA (>= 4.5:1) on the surfaces it is used on', () => {
    for (const surface of [colors.bg, colors.surface, colors.surfaceRaised]) {
      expect(contrastRatio(colors.textSubtle, surface)).toBeGreaterThanOrEqual(4.5);
    }
  });

  it('even disabled text stays legible (>= 4.5:1 on surface and raised)', () => {
    for (const surface of [colors.surface, colors.surfaceRaised]) {
      expect(contrastRatio(colors.textDisabled, surface)).toBeGreaterThanOrEqual(4.5);
    }
  });

  it('component borders and focus ring are >= 3:1 against every surface', () => {
    for (const surface of SURFACES) {
      expect(contrastRatio(colors.border, surface)).toBeGreaterThanOrEqual(3);
      expect(contrastRatio(colors.focus, surface)).toBeGreaterThanOrEqual(3);
    }
  });

  it('tone colours are AAA (>= 7:1) as text and icons on bg and surface, AA (>= 4.5:1) on raised and selected', () => {
    for (const tone of Object.keys(toneColor) as (keyof typeof toneColor)[]) {
      for (const surface of [colors.bg, colors.surface]) {
        expect(contrastRatio(toneColor[tone], surface)).toBeGreaterThanOrEqual(7);
      }
      for (const surface of [colors.surfaceRaised, colors.surfaceSelected]) {
        expect(contrastRatio(toneColor[tone], surface)).toBeGreaterThanOrEqual(4.5);
      }
    }
  });

  it('filled buttons keep AAA label contrast on their fill', () => {
    expect(contrastRatio(colors.onPrimary, colors.primary)).toBeGreaterThanOrEqual(7);
    expect(contrastRatio(colors.onWarning, colors.warning)).toBeGreaterThanOrEqual(7);
  });

  it('the red End button keeps AA label contrast (all its labels are 20 sp bold or larger, so AAA-large 4.5:1 applies)', () => {
    expect(contrastRatio(colors.onDangerSolid, colors.dangerSolid)).toBeGreaterThanOrEqual(4.5);
  });

  it('filled buttons are distinguishable from the black background as shapes (>= 3:1)', () => {
    for (const fill of [colors.primary, colors.dangerSolid, colors.warning]) {
      expect(contrastRatio(fill, colors.bg)).toBeGreaterThanOrEqual(3);
    }
  });

  it('the QR code keeps maximum contrast', () => {
    expect(contrastRatio(colors.qrDark, colors.qrLight)).toBeGreaterThanOrEqual(21);
  });
});

describe('sizes', () => {
  it('every touch target floor is at least 56 dp and ride controls at least 96 dp', () => {
    expect(hit.min).toBeGreaterThanOrEqual(56);
    expect(hit.control).toBeGreaterThanOrEqual(hit.min);
    expect(hit.large).toBeGreaterThanOrEqual(hit.control);
    expect(hit.rideMin).toBeGreaterThanOrEqual(96);
    expect(hit.rideHeight).toBeGreaterThanOrEqual(hit.rideMin);
  });

  it('type is large: running text >= 18, nothing below 14, line height always above font size', () => {
    expect(type.body.fontSize).toBeGreaterThanOrEqual(18);
    for (const variant of Object.values(type)) {
      expect(variant.fontSize).toBeGreaterThanOrEqual(14);
      expect(variant.lineHeight).toBeGreaterThan(variant.fontSize);
    }
  });

  it('every type variant caps accessibility font scaling at a sane value', () => {
    for (const variant of Object.keys(type) as (keyof typeof type)[]) {
      expect(maxFontScale[variant]).toBeGreaterThanOrEqual(1.2);
    }
  });

  it('the spacing scale is strictly increasing', () => {
    const values = Object.values(spacing);
    expect([...values].sort((a, b) => a - b)).toEqual(values);
    expect(new Set(values).size).toBe(values.length);
  });
});
