import * as Haptics from 'expo-haptics';

/** Haptic cues. Fire-and-forget: a phone without a vibrator (or the web) must never throw into the UI. */
export const haptic = {
  light(): void {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => undefined);
  },
  medium(): void {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => undefined);
  },
  tick(): void {
    Haptics.selectionAsync().catch(() => undefined);
  },
};
