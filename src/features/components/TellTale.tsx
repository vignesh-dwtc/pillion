import { useEffect } from 'react';
import { Animated, View } from 'react-native';
import { useAnimatedValue } from './motion/useAnimatedValue';

import { colors, spacing, toneColor, type Tone } from '../../app/theme';

import { AppText, Legend } from './AppText';
import { Icon, type IconName } from './Icon';
import { duration } from './motion/tokens';
import { useReducedMotion } from './motion/useReducedMotion';

const MARK: Partial<Record<Tone, IconName>> = {
  neutral: 'ellipsis',
  success: 'check',
  warning: 'warning-triangle',
  danger: 'cross',
};

/** Tell-tale legends sit in narrow cells: cap their scaling below the general legend cap (1.4). */
const LEGEND_SCALE = 1.2;

/**
 * Instrument tell-tale: a legend, a 34 dp ring around an icon, and a value word with a small check, triangle or
 * cross. The ring takes the tone colour when the state needs attention, but the mark and the word always carry it
 * too; neutral (pending) states get an ellipsis. `lightDelay` lights the lamp in sequence (ignition); reduced motion
 * lights it at once. The legend is capped at 1.2x font scale and wraps (centred) rather than touching a divider; the
 * value wraps to two lines rather than truncating.
 */
export function TellTale({
  legend,
  value,
  tone,
  icon,
  testID,
  lightDelay,
  align = 'center',
  minHeight,
}: {
  legend: string;
  value: string;
  tone: Tone;
  icon: IconName;
  testID?: string;
  lightDelay?: number;
  align?: 'center' | 'start';
  minHeight?: number;
}) {
  const reduced = useReducedMotion();
  const lit = useAnimatedValue(lightDelay === undefined ? 1 : 0.25);

  useEffect(() => {
    if (lightDelay === undefined) return;
    const animation = Animated.timing(lit, {
      toValue: 1,
      duration: reduced ? duration.reducedCrossfade : duration.ui,
      delay: reduced ? 0 : lightDelay,
      useNativeDriver: true,
    });
    animation.start();
    return () => animation.stop();
  }, [lightDelay, lit, reduced]);

  const color = toneColor[tone];
  const ringColor = tone === 'warning' || tone === 'danger' ? color : colors.border;
  const iconColor = tone === 'neutral' ? colors.textMuted : tone === 'success' ? colors.brass : color;
  const mark = MARK[tone];
  const start = align === 'start';

  return (
    <View
      testID={testID}
      accessible
      aria-label={`${legend}: ${value}`}
      style={{
        alignItems: 'center',
        gap: spacing.xs,
        minHeight,
        // Column (strip) cells fill their row and sit on its bottom, so rings and values line up across cells even
        // when one legend wraps to two lines at large font scales.
        flexGrow: start ? 0 : 1,
        justifyContent: start ? 'flex-start' : 'flex-end',
        flexDirection: start ? 'row' : 'column',
      }}
    >
      {start ? null : (
        <Legend
          align="center"
          maxFontSizeMultiplier={LEGEND_SCALE}
          style={{ fontSize: 11, letterSpacing: 1.8, paddingHorizontal: spacing.sm }}
        >
          {legend}
        </Legend>
      )}
      <Animated.View
        style={{
          opacity: lit,
          width: 34,
          height: 34,
          borderRadius: 17,
          borderWidth: 1,
          borderColor: ringColor,
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <Icon name={icon} size={18} color={iconColor} />
      </Animated.View>
      <View style={start ? { flex: 1, marginLeft: spacing.sm } : { alignItems: 'center' }}>
        {start ? (
          <Legend maxFontSizeMultiplier={LEGEND_SCALE} style={{ fontSize: 11, letterSpacing: 1.8 }}>
            {legend}
          </Legend>
        ) : null}
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
          {mark ? <Icon name={mark} size={12} color={color} strokeWidth={2} /> : null}
          <AppText
            variant="caption"
            color={tone === 'neutral' ? colors.textMuted : color}
            numberOfLines={2}
            style={start ? { flexShrink: 1 } : undefined}
          >
            {value}
          </AppText>
        </View>
      </View>
    </View>
  );
}
