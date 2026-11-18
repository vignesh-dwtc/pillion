import { useEffect, useState } from 'react';
import { AccessibilityInfo, Platform } from 'react-native';

function webPrefersReducedMotion(): boolean {
  if (Platform.OS !== 'web' || typeof globalThis.matchMedia !== 'function') return false;
  return globalThis.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/**
 * True when the system asks for reduced motion (AccessibilityInfo; on web also the prefers-reduced-motion media
 * query). Then: no sweeps, staggers, draw-ons, breathing or scale; values jump and transitions become 120 ms
 * opacity crossfades. Haptics and audio cues stay on.
 */
export function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(webPrefersReducedMotion);

  useEffect(() => {
    let alive = true;
    AccessibilityInfo.isReduceMotionEnabled().then(
      (value) => {
        if (alive) setReduced(value || webPrefersReducedMotion());
      },
      () => undefined,
    );
    const subscription = AccessibilityInfo.addEventListener('reduceMotionChanged', (value) =>
      setReduced(value || webPrefersReducedMotion()),
    );
    return () => {
      alive = false;
      subscription.remove();
    };
  }, []);

  return reduced;
}
