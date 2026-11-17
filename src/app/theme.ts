/**
 * Design tokens. Dark, high contrast and glove-friendly: pure black background (OLED, night riding), white text,
 * large type and big touch targets. Pure TypeScript on purpose (no react-native import) so Jest can verify the
 * contrast ratios and sizes in `theme.test.ts`.
 *
 * Contrast (WCAG 2.2, checked by theme.test.ts): body text >= 7:1 (AAA) on every surface it appears on, status
 * colours >= 7:1 on bg and surface (>= 4.5:1 on raised), UI component boundaries >= 3:1, button labels >= 7:1 on
 * their fill. State is never carried by colour alone:
 * every status also has an icon and a text label.
 */

export const colors = {
  bg: '#000000',
  surface: '#12161B',
  surfaceRaised: '#1C222A',
  surfaceSelected: '#2A3441',
  /** Component boundaries (>= 3:1 on bg, surface, raised and selected). */
  border: '#808C9B',
  focus: '#FFFFFF',

  text: '#FFFFFF',
  textMuted: '#B9C3CE',
  textSubtle: '#98A4B1',
  textDisabled: '#8A94A0',

  primary: '#34D17F',
  onPrimary: '#00170B',
  /** Red for text, icons and outlines on dark surfaces. */
  danger: '#FF7F7F',
  /** Red button fill (End ride) with white label: 5.6:1, and the label is always large and bold. */
  dangerSolid: '#C62828',
  onDangerSolid: '#FFFFFF',
  warning: '#FFC83D',
  onWarning: '#1F1500',
  info: '#7CC4FF',
  success: '#4ADE80',

  /** QR codes keep the standard polarity (dark modules on a light field) so every scanner reads them. */
  qrDark: '#000000',
  qrLight: '#FFFFFF',
} as const;

/** 4 dp base scale. */
export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  xxl: 32,
  huge: 48,
} as const;

export const radius = {
  sm: 8,
  md: 14,
  lg: 20,
  pill: 999,
} as const;

export const borderWidth = {
  thin: 1,
  regular: 2,
  thick: 3,
} as const;

/** Touch target sizes in dp. WCAG 2.2 asks for 24 and Material for 48; gloves need more, so 56 is our floor. */
export const hit = {
  /** Smallest allowed touch target (any control). */
  min: 56,
  /** Standard button height. */
  control: 64,
  /** Primary actions on ordinary screens (Start, Pair). */
  large: 80,
  /** Ride controls (Mute, End): at least 96, in practice much more. */
  rideMin: 96,
  rideHeight: 132,
} as const;

/** Type scale (sp). Nothing below 14; running text starts at 18. */
export const type = {
  display: { fontSize: 40, lineHeight: 48, fontWeight: '800' },
  title: { fontSize: 30, lineHeight: 36, fontWeight: '800' },
  heading: { fontSize: 22, lineHeight: 28, fontWeight: '700' },
  bodyLarge: { fontSize: 20, lineHeight: 28, fontWeight: '500' },
  body: { fontSize: 18, lineHeight: 26, fontWeight: '400' },
  label: { fontSize: 16, lineHeight: 22, fontWeight: '600' },
  mono: { fontSize: 14, lineHeight: 20, fontWeight: '400' },
} as const;

export type TypeVariant = keyof typeof type;

/** Largest accessibility font scale each variant supports before layouts would break. */
export const maxFontScale: Record<TypeVariant, number> = {
  display: 1.2,
  title: 1.3,
  heading: 1.4,
  bodyLarge: 1.6,
  body: 1.6,
  label: 1.6,
  mono: 1.4,
};

/** Maximum content width, so tablets and desktop browsers do not stretch the layout. */
export const contentMaxWidth = 560;

export type Tone = 'neutral' | 'success' | 'warning' | 'danger' | 'info';

/** Foreground colour for text and icons that are drawn directly on a surface, per tone. */
export const toneColor: Record<Tone, string> = {
  neutral: colors.textMuted,
  success: colors.success,
  warning: colors.warning,
  danger: colors.danger,
  info: colors.info,
};

// --- contrast helpers (WCAG 2.x relative luminance) ---------------------------------------------------------

function channel(value: number): number {
  const c = value / 255;
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

export function relativeLuminance(hex: string): number {
  const match = /^#([0-9a-f]{6})$/i.exec(hex);
  if (!match?.[1]) throw new Error(`Expected a #rrggbb colour, got "${hex}"`);
  const n = parseInt(match[1], 16);
  return 0.2126 * channel((n >> 16) & 255) + 0.7152 * channel((n >> 8) & 255) + 0.0722 * channel(n & 255);
}

export function contrastRatio(foreground: string, background: string): number {
  const a = relativeLuminance(foreground);
  const b = relativeLuminance(background);
  const lighter = Math.max(a, b);
  const darker = Math.min(a, b);
  return (lighter + 0.05) / (darker + 0.05);
}
