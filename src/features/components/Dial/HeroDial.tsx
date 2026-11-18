import { memo, useEffect, useState } from 'react';
import { Animated, View } from 'react-native';
import { useAnimatedValue } from '../motion/useAnimatedValue';
import Svg, { Defs, Line, Path, Text as SvgText, TextPath } from 'react-native-svg';

import { strings } from '../../../app/strings';
import { colors, fonts } from '../../../app/theme';
import { AppText } from '../AppText';
import { Icon } from '../Icon';
import { NightRoad } from '../illustrations/NightRoad';
import { duration, ease } from '../motion/tokens';
import { useReducedMotion } from '../motion/useReducedMotion';

import { BezelRing, BezelTicks, DialLayer, bezelMetrics } from './Bezel';
import { arcPath } from './geometry';
import { Guilloche } from './Guilloche';
import { SubDial } from './SubDial';

let heroIds = 0;

export interface HeroDialPair {
  riderInitial: string;
  pillionInitial: string;
  /** "17 NOV 2026" */
  since: string;
  /** "1 H 12 MIN"; the date window is hidden when there is no ride history. */
  lastRide?: string | null;
}

const Engraving = memo(function Engraving({
  size,
  id,
  pair,
}: {
  size: number;
  id: string;
  pair: HeroDialPair | null;
}) {
  const m = bezelMetrics(size);
  const r = m.face - 13;
  const c = m.c;
  return (
    <Svg width={size} height={size} style={{ position: 'absolute', left: 0, top: 0 }}>
      <Defs>
        <Path id={`${id}-arc`} d={arcPath(c, c, r, 252, 216)} />
      </Defs>
      <SvgText
        fill={colors.brass}
        fontFamily={fonts.legend}
        fontSize={10}
        letterSpacing={1.6}
        textAnchor="middle"
      >
        <TextPath href={`#${id}-arc`} startOffset="50%">
          {(size < 260 ? strings.home.dialLegendShort : strings.home.dialLegend).toUpperCase()}
        </TextPath>
      </SvgText>
      {pair ? (
        <>
          <SvgText
            x={c}
            y={c + size * 0.235}
            fill={colors.textSubtle}
            fontFamily={fonts.legend}
            fontSize={10}
            letterSpacing={2.4}
            textAnchor="middle"
          >
            {strings.home.dialPaired.toUpperCase()}
          </SvgText>
          <SvgText
            x={c}
            y={c + size * 0.235 + 15}
            fill={colors.textMuted}
            fontFamily={fonts.legend}
            fontSize={11}
            letterSpacing={1.8}
            textAnchor="middle"
          >
            {strings.home.dialSince(pair.since).toUpperCase()}
          </SvgText>
        </>
      ) : (
        <SvgText
          x={c}
          y={c + size * 0.25}
          fill={colors.textSubtle}
          fontFamily={fonts.legend}
          fontSize={10}
          letterSpacing={2.4}
          textAnchor="middle"
        >
          {strings.home.dialUnpaired.toUpperCase()}
        </SvgText>
      )}
    </Svg>
  );
});

/** A dotted half-link that draws in from its outer end (scaleX about that end: native driver). */
function LinkHalf({
  width,
  from,
  progress,
  broken,
}: {
  width: number;
  from: 'left' | 'right';
  progress: Animated.Value;
  broken: boolean;
}) {
  const sign = from === 'left' ? -1 : 1;
  const translateX = progress.interpolate({
    inputRange: [0, 1],
    outputRange: [(sign * width) / 2, 0],
  });
  const stub = broken ? width * 0.55 : width;
  const x1 = from === 'left' ? 0 : width - stub;
  const x2 = from === 'left' ? stub : width;
  return (
    <Animated.View style={{ width, height: 12, transform: [{ translateX }, { scaleX: progress }] }}>
      <Svg width={width} height={12}>
        <Line
          x1={x1 + 2}
          y1={6}
          x2={x2 - 2}
          y2={6}
          stroke={broken ? colors.textSubtle : colors.brass}
          strokeWidth={2}
          strokeDasharray="0.1 5"
          strokeLinecap="round"
        />
        {broken ? (
          <Line
            x1={from === 'left' ? stub + 1 : x1 - 5}
            y1={10}
            x2={from === 'left' ? stub + 5 : x1 - 1}
            y2={2}
            stroke={colors.textSubtle}
            strokeWidth={1.2}
            strokeLinecap="round"
          />
        ) : null}
      </Svg>
    </Animated.View>
  );
}

/**
 * Home hero dial. Paired: brass bezel with 60 ticks, a guilloche face, two monogram sub-dials (rider and pillion)
 * joined by a dotted brass link with a patina check medallion, and "PAIRED / SINCE <date>". Not paired: empty
 * sub-dials engraved "?", a broken link, and the night-road etching faint in the face.
 *
 * Mount, once: the ticks fade in clockwise in 5 groups (600 ms), the guilloche settles 2 degrees (800 ms), then the
 * link draws in from both ends (700 ms) and the medallion scales in. Reduced motion: everything is simply there.
 */
export function HeroDial({
  size,
  pair,
  accessibilityLabel,
  testID,
}: {
  size: number;
  pair: HeroDialPair | null;
  accessibilityLabel: string;
  testID?: string;
}) {
  const reduced = useReducedMotion();
  const [id] = useState(() => `hero${++heroIds}`);
  const m = bezelMetrics(size);
  const link = useAnimatedValue(reduced ? 1 : 0);
  const medal = useAnimatedValue(reduced ? 1 : 0);

  useEffect(() => {
    if (reduced) {
      link.setValue(1);
      medal.setValue(1);
      return;
    }
    const animation = Animated.sequence([
      Animated.delay(420),
      Animated.timing(link, { toValue: 1, duration: 700, easing: ease, useNativeDriver: true }),
      Animated.timing(medal, { toValue: 1, duration: duration.ui, easing: ease, useNativeDriver: true }),
    ]);
    animation.start();
    return () => animation.stop();
  }, [reduced, link, medal]);

  const compact = size < 260;
  const sub = Math.round(size * (compact ? 0.22 : 0.25));
  const offset = size * 0.215;
  const cy = m.c + size * (compact ? 0.04 : -0.01);
  const gap = offset * 2 - sub;
  const medalSize = 24;
  const halfWidth = Math.max(8, (gap - medalSize) / 2 - 2);
  const medalScale = medal.interpolate({ inputRange: [0, 1], outputRange: [0.8, 1] });

  const monogram = (initial: string | null, legend: string) => (
    <SubDial size={sub} dashed={!initial}>
      <AppText
        variant="title"
        color={initial ? colors.brassLight : colors.textSubtle}
        maxFontSizeMultiplier={1}
        style={{ fontSize: Math.round(sub * 0.34), lineHeight: Math.round(sub * 0.4) }}
      >
        {initial ?? '?'}
      </AppText>
      <AppText variant="dialLegend" maxFontSizeMultiplier={1}>
        {legend}
      </AppText>
    </SubDial>
  );

  return (
    <View
      testID={testID}
      role="img"
      aria-label={accessibilityLabel}
      style={{ width: size, height: size, alignSelf: 'center' }}
    >
      <DialLayer size={size}>
        <BezelRing size={size} id={id} />
        {pair ? null : (
          <View
            style={{
              position: 'absolute',
              left: m.c - m.face,
              top: m.c - m.face,
              width: m.face * 2,
              height: m.face * 2,
              borderRadius: m.face,
              overflow: 'hidden',
            }}
          >
            <View style={{ opacity: 0.12, marginTop: m.face * 0.55 }}>
              <NightRoad width={m.face * 2} height={m.face * 1.2} fade={false} />
            </View>
          </View>
        )}
        <Guilloche size={size} radius={m.face} settle={!reduced} />
        <BezelTicks size={size} animateIn={!reduced} />
        <Engraving size={size} id={id} pair={pair} />
        <View
          style={{
            position: 'absolute',
            left: m.c - 12,
            top: m.c - size * 0.3,
            width: 24,
            height: 24,
          }}
        >
          <Icon name="motorcycle" size={24} color={colors.brass} />
        </View>
        <View
          style={{
            position: 'absolute',
            left: 0,
            right: 0,
            top: cy - sub / 2,
            height: sub,
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          {monogram(pair?.riderInitial ?? null, strings.home.dialRider)}
          <View style={{ width: gap, flexDirection: 'row', alignItems: 'center', justifyContent: 'center' }}>
            <LinkHalf width={halfWidth} from="left" progress={link} broken={!pair} />
            <Animated.View
              style={{
                width: medalSize,
                height: medalSize,
                marginHorizontal: 2,
                borderRadius: medalSize / 2,
                borderWidth: 1,
                borderColor: pair ? colors.patina : colors.hairline,
                backgroundColor: colors.face,
                alignItems: 'center',
                justifyContent: 'center',
                opacity: pair ? medal : 0,
                transform: [{ scale: medalScale }],
              }}
            >
              {pair ? <Icon name="check" size={14} color={colors.patina} strokeWidth={2} /> : null}
            </Animated.View>
            <LinkHalf width={halfWidth} from="right" progress={link} broken={!pair} />
          </View>
          {monogram(pair?.pillionInitial ?? null, strings.home.dialPillion)}
        </View>
        {pair?.lastRide ? (
          <View
            style={{
              position: 'absolute',
              left: m.c - 46,
              top: m.c + size * 0.32,
              width: 92,
              paddingVertical: 2,
              borderWidth: 1,
              borderColor: colors.brassShadow,
              backgroundColor: colors.face,
              alignItems: 'center',
            }}
          >
            <AppText variant="dialLegend" color={colors.textMuted} maxFontSizeMultiplier={1}>
              {strings.home.dialLast(pair.lastRide)}
            </AppText>
          </View>
        ) : null}
      </DialLayer>
    </View>
  );
}
