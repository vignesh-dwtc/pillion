import { memo, useEffect } from 'react';
import { Animated } from 'react-native';
import { useAnimatedValue } from '../motion/useAnimatedValue';
import Svg, { G, Path } from 'react-native-svg';

import { colors } from '../../../app/theme';
import { ease } from '../motion/tokens';

import { rosettePath } from './geometry';

const ROSETTES = [
  { petals: 30, scale: 0.96, depth: 0.08, copies: 5, opacity: 0.16 },
  { petals: 18, scale: 0.66, depth: 0.14, copies: 5, opacity: 0.13 },
  { petals: 12, scale: 0.36, depth: 0.2, copies: 4, opacity: 0.11 },
] as const;

const GuillocheArt = memo(function GuillocheArt({ size, radius }: { size: number; radius: number }) {
  const c = size / 2;
  return (
    <Svg width={size} height={size}>
      {ROSETTES.map((rosette) => (
        <G key={rosette.petals} opacity={rosette.opacity}>
          {Array.from({ length: rosette.copies }, (_, i) => (
            <Path
              key={i}
              d={rosettePath(
                c,
                c,
                radius * rosette.scale,
                rosette.petals,
                rosette.depth,
                (i * 360) / rosette.petals / rosette.copies,
              )}
              fill="none"
              stroke={colors.brass}
              strokeWidth={0.6}
            />
          ))}
        </G>
      ))}
    </Svg>
  );
});

/**
 * Guilloche face: three rosettes (30, 18, 12 petals) at 10-16 % opacity, inside the face radius. `settle`: rotates
 * 2 degrees into place once (800 ms). Decorative only.
 */
export function Guilloche({ size, radius, settle }: { size: number; radius: number; settle: boolean }) {
  const turn = useAnimatedValue(settle ? 0 : 1);
  useEffect(() => {
    if (!settle) return;
    const animation = Animated.timing(turn, {
      toValue: 1,
      duration: 800,
      easing: ease,
      useNativeDriver: true,
    });
    animation.start();
    return () => animation.stop();
  }, [settle, turn]);
  const rotate = turn.interpolate({ inputRange: [0, 1], outputRange: ['-2deg', '0deg'] });
  return (
    <Animated.View
      style={{ position: 'absolute', left: 0, top: 0, width: size, height: size, transform: [{ rotate }] }}
    >
      <GuillocheArt size={size} radius={radius} />
    </Animated.View>
  );
}
