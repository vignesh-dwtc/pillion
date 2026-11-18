import { useEffect } from 'react';
import { Animated, Pressable, View } from 'react-native';
import { useAnimatedValue } from './motion/useAnimatedValue';
import Svg, { Circle, Defs, Line, RadialGradient, Stop } from 'react-native-svg';

import { strings } from '../../app/strings';
import { colors, hit, spacing } from '../../app/theme';

import { AppText } from './AppText';
import { ease } from './motion/tokens';
import { useReducedMotion } from './motion/useReducedMotion';
import { haptic } from './motion/haptics';

const KNOB = 36;
const KNURLS = 24;

function Knob({ on }: { on: boolean }) {
  const c = KNOB / 2;
  return (
    <Svg width={KNOB} height={KNOB}>
      <Defs>
        <RadialGradient id={on ? 'rk-on' : 'rk-off'} cx="45%" cy="35%" r="65%">
          <Stop offset="0" stopColor={on ? colors.brassLight : colors.surfaceRaised} />
          <Stop offset="1" stopColor={on ? colors.brassDeep : colors.bg} />
        </RadialGradient>
      </Defs>
      {Array.from({ length: KNURLS }, (_, i) => {
        const a = (i * 2 * Math.PI) / KNURLS;
        return (
          <Line
            key={i}
            x1={c + (c - 0.8) * Math.cos(a)}
            y1={c + (c - 0.8) * Math.sin(a)}
            x2={c + (c - 3.6) * Math.cos(a)}
            y2={c + (c - 3.6) * Math.sin(a)}
            stroke={on ? colors.brassDeep : colors.border}
            strokeWidth={1}
          />
        );
      })}
      <Circle
        cx={c}
        cy={c}
        r={c - 4}
        fill={on ? 'url(#rk-on)' : 'url(#rk-off)'}
        stroke={on ? colors.brassDeep : colors.border}
        strokeWidth={1}
      />
      <Line
        x1={c}
        y1={6}
        x2={c}
        y2={c - 2}
        stroke={on ? colors.onBrass : colors.textMuted}
        strokeWidth={2}
        strokeLinecap="round"
      />
    </Svg>
  );
}

/**
 * Settings toggle: a 36 dp knurled knob that rotates 90 degrees (180 ms) with an On/Off word. The whole row is the
 * hit target (56 dp, role switch). State is shown by the knob position, its fill and the word: never colour alone.
 */
export function RotarySwitch({
  label,
  hint,
  value,
  onValueChange,
  disabled = false,
  testID,
}: {
  label: string;
  hint?: string;
  value: boolean;
  onValueChange: (value: boolean) => void;
  disabled?: boolean;
  testID?: string;
}) {
  const reduced = useReducedMotion();
  const turn = useAnimatedValue(value ? 1 : 0);
  useEffect(() => {
    if (reduced) {
      turn.setValue(value ? 1 : 0);
      return;
    }
    Animated.timing(turn, {
      toValue: value ? 1 : 0,
      duration: 180,
      easing: ease,
      useNativeDriver: true,
    }).start();
  }, [value, reduced, turn]);
  const rotate = turn.interpolate({ inputRange: [0, 1], outputRange: ['-90deg', '0deg'] });

  return (
    <Pressable
      testID={testID}
      role="switch"
      aria-label={label}
      aria-checked={value}
      aria-disabled={disabled || undefined}
      disabled={disabled}
      onPress={() => {
        haptic.tick();
        onValueChange(!value);
      }}
      style={({ pressed }) => ({
        minHeight: hit.row,
        flexDirection: 'row',
        alignItems: 'center',
        gap: spacing.md,
        paddingVertical: spacing.sm,
        paddingHorizontal: spacing.xs,
        backgroundColor: pressed ? colors.surfaceRaised : 'transparent',
        opacity: disabled ? 0.5 : 1,
      })}
    >
      <View style={{ flex: 1, gap: 1 }}>
        <AppText variant="bodyLarge">{label}</AppText>
        {hint ? (
          <AppText variant="caption" color={colors.textSubtle}>
            {hint}
          </AppText>
        ) : null}
      </View>
      <AppText
        variant="legend"
        color={value ? colors.brass : colors.textSubtle}
        style={{ minWidth: 34, textAlign: 'right' }}
      >
        {value ? strings.common.on : strings.common.off}
      </AppText>
      <Animated.View
        style={{
          width: KNOB,
          height: KNOB,
          transform: [{ rotate: reduced ? (value ? '0deg' : '-90deg') : rotate }],
        }}
      >
        <Knob on={value} />
      </Animated.View>
    </Pressable>
  );
}
