/**
 * Design tokens: "Brass Chronograph". A warm, dark, instrument-like theme: ivory type and brass engraving on a
 * near-black dial, like a vintage chronograph read at night. Pure TypeScript on purpose (no react-native import) so
 * Jest can verify contrast ratios and sizes in `theme.test.ts`.
 *
 * Contrast (WCAG 2.2, asserted in theme.test.ts): body and status text >= 7:1 (AAA) on bg, surface and raised;
 * subtle text (legends, captions) >= 4.5:1; labels on filled plates >= 4.5:1 (all plate labels are 17 sp or larger);
 * component boundaries >= 3:1. Decorative layers (hairline, brassShadow, guilloche) never mark a boundary or carry
 * state. Every state is shown as ring + icon + word: colour is never the only signal.
 */

export const colors = {
  /** Warm near-black app background (never pure #000). */
  bg: '#0B0A08',
  /** Decorative radial lift behind hero dials and at the top of every screen. */
  bgLift: '#1A160F',
  /** Dial faces and cards. */
  surface: '#15130F',
  /** Pressed or selected rows, sheets. */
  surfaceRaised: '#1E1B16',
  /** Inner faces of sub-dials. */
  face: '#100E0A',
  /** Decorative rules and dividers only; never a component boundary. */
  hairline: '#2E2920',
  /** Component boundaries (>= 3:1 on bg, surface and raised). */
  border: '#7E6E55',

  text: '#F3EBDD',
  textMuted: '#C3B8A5',
  textSubtle: '#9C9282',

  /** The accent: icons, bezels, wordmark, Mute label, primary plate fill. */
  brass: '#D2AE6D',
  brassLight: '#E6C98F',
  brassDeep: '#B8914F',
  /** Minor ticks, sub-dial rims, guilloche. Decorative only. */
  brassShadow: '#6E5530',
  /** Labels on brass. */
  onBrass: '#17110A',

  /** Pairing-plate field; QR modules are onBrass. */
  enamel: '#F6F1E6',
  enamelCaption: '#5E5446',

  /** Success / linked. */
  patina: '#86CDB0',
  /** Warning, reconnecting, muted. */
  amber: '#EDB65A',
  /** Error text and icons. */
  vermilion: '#EE8C74',
  /**
   * End-ride fill. The plate is a gradient oxbloodTop -> oxbloodBottom, kept at or below `oxblood` in lightness so it
   * reads as deep lacquer rather than an alarm button.
   */
  oxblood: '#8B2A1D',
  oxbloodTop: '#832B20',
  oxbloodBottom: '#651E16',
  /** The Mute plate. */
  muteFill: '#241E15',

  /** QR codes: dark modules on the enamel field (standard polarity, every scanner reads it). */
  qrDark: '#17110A',
  qrLight: '#F6F1E6',
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

/** Side gutter of every screen. */
export const gutter = 22;

export const radius = {
  sm: 6,
  md: 10,
  lg: 14,
  pill: 999,
} as const;

/** Plates are chamfered polygons, not rounded rectangles: corner cut in dp. */
export const chamfer = {
  plate: 12,
  ride: 16,
} as const;

/** `hair` is the nominal value; components use StyleSheet.hairlineWidth (the device's real hairline). */
export const borderWidth = {
  hair: 0.5,
  thin: 1,
  regular: 1.5,
} as const;

/** Touch target sizes in dp. */
export const hit = {
  /** Smallest allowed touch target (icon rings: 48 visible, hitSlop to 56). */
  min: 48,
  /** Every list row. */
  row: 56,
  /** Secondary buttons. */
  control: 56,
  /** The primary plate (Begin ride, Pair your pillion). */
  primary: 76,
  /** Ride controls: at least 96. */
  rideMin: 96,
  /** Mute and End plates. */
  rideHeight: 124,
} as const;

/** Bundled font families (keys of the useFonts map in src/app/fonts.ts). */
export const fonts = {
  title: 'Marcellus_400Regular',
  legend: 'MarcellusSC_400Regular',
  body: 'BarlowSemiCondensed_400Regular',
  bodyMedium: 'BarlowSemiCondensed_500Medium',
  bodySemi: 'BarlowSemiCondensed_600SemiBold',
  script: 'CormorantGaramond_500Medium_Italic',
} as const;

/** Letter spacing in dp for a tracking given in em. */
export function tracking(fontSize: number, em: number): number {
  return Math.round(fontSize * em * 100) / 100;
}

const TABULAR = ['tabular-nums'] as ['tabular-nums'];

/** Type scale (sp). Smaller and lighter than a system UI: the faces do the work, not the weight. */
export const type = {
  /** Ride time only. */
  gaugeNumeral: { fontFamily: fonts.bodyMedium, fontSize: 44, lineHeight: 48, fontVariant: TABULAR },
  /** Onboarding plate titles only. */
  display: { fontFamily: fonts.title, fontSize: 28, lineHeight: 34 },
  /** Screen titles. */
  title: { fontFamily: fonts.title, fontSize: 24, lineHeight: 30 },
  heading: { fontFamily: fonts.title, fontSize: 19, lineHeight: 24 },
  /** Partner name only, never below 20. */
  partnerScript: { fontFamily: fonts.script, fontSize: 30, lineHeight: 34 },
  partnerScriptRow: { fontFamily: fonts.script, fontSize: 22, lineHeight: 26 },
  /** Ride and primary plates. */
  plateLabel: { fontFamily: fonts.title, fontSize: 21, lineHeight: 26, letterSpacing: tracking(21, 0.04) },
  /** 56 dp secondary buttons. */
  button: { fontFamily: fonts.title, fontSize: 17, lineHeight: 22 },
  /** Row labels and status lines. */
  bodyLarge: { fontFamily: fonts.bodyMedium, fontSize: 16, lineHeight: 22 },
  body: { fontFamily: fonts.body, fontSize: 15, lineHeight: 21 },
  value: { fontFamily: fonts.bodySemi, fontSize: 15, lineHeight: 20, fontVariant: TABULAR },
  caption: { fontFamily: fonts.bodyMedium, fontSize: 13, lineHeight: 18 },
  /** Engraved legends: always uppercase and tracked. */
  legend: {
    fontFamily: fonts.legend,
    fontSize: 12,
    lineHeight: 16,
    letterSpacing: tracking(12, 0.2),
    textTransform: 'uppercase',
  },
  wordmark: {
    fontFamily: fonts.legend,
    fontSize: 17,
    lineHeight: 22,
    letterSpacing: tracking(17, 0.36),
    textTransform: 'uppercase',
  },
  /** SVG sub-dials only, always next to a value of 15 or more. */
  dialLegend: {
    fontFamily: fonts.legend,
    fontSize: 10,
    lineHeight: 12,
    letterSpacing: tracking(10, 0.18),
    textTransform: 'uppercase',
  },
  /** Diagnostics report text. */
  mono: { fontFamily: fonts.body, fontSize: 13, lineHeight: 18, fontVariant: TABULAR },
} as const;

export type TypeVariant = keyof typeof type;

/** Largest accessibility font scale each variant supports before layouts would break. Scaling stays on. */
export const maxFontScale: Record<TypeVariant, number> = {
  gaugeNumeral: 1.15,
  display: 1.2,
  title: 1.3,
  heading: 1.3,
  partnerScript: 1.2,
  partnerScriptRow: 1.3,
  plateLabel: 1.3,
  button: 1.3,
  bodyLarge: 1.6,
  body: 1.6,
  value: 1.6,
  caption: 1.6,
  legend: 1.4,
  wordmark: 1.2,
  dialLegend: 1.0,
  mono: 1.4,
};

/** Interactive text never below this. */
export const INTERACTIVE_TEXT_MIN = 15;
/** Status words never below this. */
export const STATUS_TEXT_MIN = 13;
/** Nothing below this. */
export const TEXT_FLOOR = 10;

/** Maximum content width, so tablets and desktop browsers do not stretch the layout. */
export const contentMaxWidth = 560;

export type Tone = 'neutral' | 'success' | 'warning' | 'danger' | 'info';

/** Foreground colour for text and icons that are drawn directly on a surface, per tone. */
export const toneColor: Record<Tone, string> = {
  neutral: colors.textMuted,
  success: colors.patina,
  warning: colors.amber,
  danger: colors.vermilion,
  info: colors.brass,
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
