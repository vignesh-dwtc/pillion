import { Children, isValidElement, useEffect, type ReactNode } from 'react';
import { Animated, type StyleProp, type ViewStyle } from 'react-native';
import { useAnimatedValue } from './useAnimatedValue';

import { RISE, STAGGER_MS, duration, ease } from './tokens';
import { useReducedMotion } from './useReducedMotion';

/**
 * Fades and rises one element into place (420 ms, 8 dp), once, on mount. `index` staggers siblings by 60 ms.
 * Reduced motion: a 120 ms opacity crossfade, no rise.
 */
export function FadeRise({
  children,
  index = 0,
  style,
  rise = RISE,
}: {
  children: ReactNode;
  index?: number;
  style?: StyleProp<ViewStyle>;
  rise?: number;
}) {
  const reduced = useReducedMotion();
  const progress = useAnimatedValue(0);

  useEffect(() => {
    const animation = Animated.timing(progress, {
      toValue: 1,
      duration: reduced ? duration.reducedCrossfade : duration.entrance,
      delay: reduced ? 0 : Math.min(index, 10) * STAGGER_MS,
      easing: ease,
      useNativeDriver: true,
    });
    animation.start();
    return () => animation.stop();
    // Runs once on mount: an entrance, not a reaction to later changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const translateY = progress.interpolate({ inputRange: [0, 1], outputRange: [reduced ? 0 : rise, 0] });
  return (
    <Animated.View style={[style, { opacity: progress, transform: [{ translateY }] }]}>
      {children}
    </Animated.View>
  );
}

/** Staggers each direct child with FadeRise (60 ms apart). */
export function Stagger({ children }: { children: ReactNode }) {
  return (
    <>
      {Children.toArray(children).map((child, index) => (
        <FadeRise key={isValidElement(child) && child.key !== null ? child.key : index} index={index}>
          {child}
        </FadeRise>
      ))}
    </>
  );
}
