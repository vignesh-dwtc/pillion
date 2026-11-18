import { memo, useEffect, useState } from 'react';
import { View } from 'react-native';
import Svg, { Circle, Line, Path } from 'react-native-svg';

import { colors } from '../../app/theme';

import { polar, ticksPath } from './Dial/geometry';
import { useAppActive } from './motion/useAppActive';
import { useReducedMotion } from './motion/useReducedMotion';

const Face = memo(function Face({ size }: { size: number }) {
  const c = size / 2;
  return (
    <>
      <Circle cx={c} cy={c} r={c - 1.5} fill={colors.face} stroke={colors.brass} strokeWidth={1.5} />
      <Path
        d={ticksPath(c, c, c - 4, c - 7.5, 12, 0, 30)}
        stroke={colors.brassShadow}
        strokeWidth={1.2}
        strokeLinecap="round"
      />
      <Path d={`M${c - 3} 0.5h6`} stroke={colors.brass} strokeWidth={2} strokeLinecap="round" />
    </>
  );
});

/**
 * 44 dp stopwatch: a bezel with 12 ticks and a hand that steps once per second (a stepped tick, no continuous loop;
 * paused when the app is not active; still under reduced motion).
 */
export function Stopwatch({ size = 44 }: { size?: number }) {
  const active = useAppActive();
  const reduced = useReducedMotion();
  const [step, setStep] = useState(0);
  useEffect(() => {
    if (!active || reduced) return;
    const timer = setInterval(() => setStep((s) => (s + 1) % 60), 1000);
    return () => clearInterval(timer);
  }, [active, reduced]);
  const c = size / 2;
  const tip = polar(c, c, c - 8, step * 6);
  return (
    <View
      aria-hidden
      accessible={false}
      importantForAccessibility="no-hide-descendants"
      style={{ width: size, height: size }}
    >
      <Svg width={size} height={size}>
        <Face size={size} />
        <Line
          x1={c}
          y1={c}
          x2={tip.x}
          y2={tip.y}
          stroke={colors.brassLight}
          strokeWidth={1.6}
          strokeLinecap="round"
        />
        <Circle cx={c} cy={c} r={2.2} fill={colors.brassLight} />
      </Svg>
    </View>
  );
}
