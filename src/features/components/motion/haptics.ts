import * as Haptics from 'expo-haptics';

/** Haptic cues. Fire-and-forget: a phone without a vibrator (or the web) must never throw into the UI. */
export const haptic = {
  light(): void {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => undefined);
  },
  medium(): void {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => undefined);
  },
  /** Pairing saved: the system "success" pattern. */
  success(): void {
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => undefined);
  },
  /** A rejected scan: the system "warning" pattern. */
  warning(): void {
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning).catch(() => undefined);
  },
  tick(): void {
    Haptics.selectionAsync().catch(() => undefined);
  },
};
