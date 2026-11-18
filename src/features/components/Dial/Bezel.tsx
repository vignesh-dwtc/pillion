import { memo, useEffect, useState, type ReactNode } from 'react';
import { Animated, View } from 'react-native';
import Svg, { Circle, Defs, LinearGradient, Path, RadialGradient, Stop } from 'react-native-svg';

import { colors } from '../../../app/theme';
import { ease } from '../motion/tokens';

import { polar, ticksPath } from './geometry';

/** Ring metrics for a dial of `size`. */
export function bezelMetrics(size: number) {
  const c = size / 2;
  const R = c - 1;
  const ring = Math.max(8, size * 0.04);
  const tickOuter = R - ring - 4;
  const tickMinor = tickOuter - 5;
  const tickMajor = tickOuter - 10;
  const face = tickMajor - 4;
  return { c, R, ring, tickOuter, tickMinor, tickMajor, face };
}

const GROUPS = 5;

const full = { position: 'absolute', left: 0, top: 0 } as const;

/** Static bezel ring, face and index triangle (memoised: never re-rendered on ticks). */
export const BezelRing = memo(function BezelRing({ size, id }: { size: number; id: string }) {
  const m = bezelMetrics(size);
  const tri = [
    polar(m.c, m.c, m.tickOuter + 1, 0),
    polar(m.c, m.c, m.tickMajor - 2, -3.2),
    polar(m.c, m.c, m.tickMajor - 2, 3.2),
  ];
  return (
    <Svg width={size} height={size} style={full}>
      <Defs>
        <LinearGradient id={`${id}-metal`} x1="0" y1="0" x2="1" y2="1">
          <Stop offset="0" stopColor={colors.brassLight} />
          <Stop offset="0.35" stopColor={colors.brassDeep} />
          <Stop offset="0.6" stopColor={colors.brassShadow} />
          <Stop offset="1" stopColor={colors.brass} />
        </LinearGradient>
        <RadialGradient id={`${id}-face`} cx="50%" cy="40%" r="60%">
          <Stop offset="0" stopColor={colors.surfaceRaised} />
          <Stop offset="1" stopColor={colors.surface} />
        </RadialGradient>
      </Defs>
      <Circle
        cx={m.c}
        cy={m.c}
        r={m.R - m.ring / 2}
        fill={colors.face}
        stroke={`url(#${id}-metal)`}
        strokeWidth={m.ring}
      />
      <Circle cx={m.c} cy={m.c} r={m.R - 0.5} fill="none" stroke={colors.brassShadow} strokeWidth={1} />
      <Circle
        cx={m.c}
        cy={m.c}
        r={m.R - m.ring - 0.5}
        fill="none"
        stroke={colors.brassShadow}
        strokeWidth={1}
      />
      <Circle cx={m.c} cy={m.c} r={m.face} fill={`url(#${id}-face)`} />
      <Circle cx={m.c} cy={m.c} r={m.face} fill="none" stroke={colors.hairline} strokeWidth={1} />
      <Path
        d={`M${tri[0]!.x} ${tri[0]!.y}L${tri[1]!.x} ${tri[1]!.y}L${tri[2]!.x} ${tri[2]!.y}Z`}
        fill={colors.brassLight}
      />
    </Svg>
  );
});

const TickGroup = memo(function TickGroup({ size, group }: { size: number; group: number }) {
  const m = bezelMetrics(size);
  const per = 60 / GROUPS;
  const start = group * per;
  const minor = ticksPath(
    m.c,
    m.c,
    m.tickOuter,
    m.tickMinor,
    per,
    start * 6,
    6,
    (i) => (start + i) % 5 !== 0,
  );
  const major = ticksPath(
    m.c,
    m.c,
    m.tickOuter,
    m.tickMajor,
    per,
    start * 6,
    6,
    (i) => (start + i) % 5 === 0 && start + i !== 0,
  );
  return (
    <Svg width={size} height={size} style={full}>
      <Path d={minor} stroke={colors.brassShadow} strokeWidth={1} strokeLinecap="round" />
      <Path d={major} stroke={colors.brass} strokeWidth={1.8} strokeLinecap="round" />
    </Svg>
  );
});

/**
 * 60 bezel ticks (every 5th long and brass) in 5 groups. `animateIn`: the groups fade in clockwise once
 * (600 ms in total); otherwise they are simply there.
 */
export function BezelTicks({ size, animateIn }: { size: number; animateIn: boolean }) {
  const [values] = useState(() =>
    Array.from({ length: GROUPS }, () => new Animated.Value(animateIn ? 0 : 1)),
  );
  useEffect(() => {
    if (!animateIn) return;
    const animation = Animated.stagger(
      120,
      values.map((v) =>
        Animated.timing(v, { toValue: 1, duration: 160, easing: ease, useNativeDriver: true }),
      ),
    );
    animation.start();
    return () => animation.stop();
  }, [animateIn, values]);

  return (
    <>
      {values.map((opacity, group) => (
        <Animated.View
          key={group}
          style={[full, { width: size, height: size, opacity }]}
          pointerEvents="none"
        >
          <TickGroup size={size} group={group} />
        </Animated.View>
      ))}
    </>
  );
}

/** Decorative wrapper: hidden from assistive technology, never touchable. */
export function DialLayer({ size, children }: { size: number; children: ReactNode }) {
  return (
    <View
      aria-hidden
      accessible={false}
      importantForAccessibility="no-hide-descendants"
      pointerEvents="none"
      style={[full, { width: size, height: size }]}
    >
      {children}
    </View>
  );
}
