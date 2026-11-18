import { Easing } from 'react-native';

/**
 * Motion tokens. Motion is purposeful and battery-light: one-shot entrances and signature moments, and while
 * riding only the pointer, a slow lamp breath and the once-per-second timer move. React Native Animated
 * (opacity/transform on the native driver); SVG dash and rotation only for one-shot animations <= 900 ms.
 */
export const ease = Easing.bezier(0.2, 0.8, 0.2, 1);

export const duration = {
  micro: 100,
  ui: 220,
  entrance: 420,
  signature: 800,
  /** Reduced motion: every transition becomes a short opacity crossfade. */
  reducedCrossfade: 120,
  /** Mute frame crossfade. */
  mute: 160,
  /** End-ride hold. */
  hold: 1000,
  holdRelease: 200,
} as const;

/** Child stagger of a screen entrance. */
export const STAGGER_MS = 60;
/** Rise of an entering element in dp. */
export const RISE = 8;

/** Gauge pointer spring: overshoot stays under 3 %. */
export const needleSpring = { damping: 18, stiffness: 140, mass: 1, overshootClamping: false } as const;

/** Lamp breath while riding: opacity 0.85 to 1 over 4 s. */
export const BREATH_MS = 4000;
