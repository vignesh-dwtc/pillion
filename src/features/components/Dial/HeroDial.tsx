import { memo, useEffect, useState } from 'react';
import { Animated, View } from 'react-native';
import { useAnimatedValue } from '../motion/useAnimatedValue';
import Svg, { Defs, Line, Path, Text as SvgText, TextPath } from 'react-native-svg';

import { strings } from '../../../app/strings';
import { colors, fonts } from '../../../app/theme';
import { AppText } from '../AppText';
import { Icon } from '../Icon';
import { duration, ease } from '../motion/tokens';
import { useReducedMotion } from '../motion/useReducedMotion';

import { BezelRing, BezelTicks, DialLayer, bezelMetrics } from './Bezel';
import { arcPath, chordWidth, fitTracking } from './geometry';
import { Guilloche } from './Guilloche';
import { SubDial, legendTracking } from './SubDial';

let heroIds = 0;

export interface HeroDialPair {
  riderInitial: string;
  pillionInitial: string;
  /** "17 NOV 2026" */
  since: string;
  /** "1 H 12 MIN"; the date window is hidden when there is no ride history. */
  lastRide?: string | null;
}

/** Geometry shared by the engraving and the sub-dials, so the legends are placed against the real dials. */
function heroLayout(size: number, paired: boolean) {
  const m = bezelMetrics(size);
  const compact = size < 260;
  const sub = Math.round(size * 0.25);
  const offset = size * (paired ? 0.215 : 0.2);
  const cy = m.c + (paired ? -size * 0.01 : -size * 0.025);
  // Empty variant: RIDER / PILLION are engraved under the sub-dials (they do not fit inside a "?" dial).
  const belowLegendY = cy + sub / 2 + 13;
  const bottomLegendY = m.c + size * 0.25;
  return { ...m, compact, sub, offset, cy, belowLegendY, bottomLegendY };
}

const LEGEND_PX = 10;

const Engraving = memo(function Engraving({
  size,
  id,
  pair,
}: {
  size: number;
  id: string;
  pair: HeroDialPair | null;
}) {
  const L = heroLayout(size, pair !== null);
  const r = L.face - 13;
  const c = L.c;
  // Room for a legend centred on x at baseline y: the chord of the face (6 dp inside it) at the cap top.
  const room = (y: number, x = 0) => chordWidth(L.face - 6, y - c - 7) - 2 * Math.abs(x - c);
  const tracked = (text: string, y: number, preferred: number, x = c) =>
    fitTracking(text, LEGEND_PX, room(y, x), preferred) ?? 0;
  const below = [
    { x: c - L.offset, text: strings.home.dialRider.toUpperCase() },
    { x: c + L.offset, text: strings.home.dialPillion.toUpperCase() },
  ];
  const unpaired = strings.home.dialUnpaired.toUpperCase();
  return (
    <Svg width={size} height={size} style={{ position: 'absolute', left: 0, top: 0 }}>
      {L.compact ? null : (
        <>
          <Defs>
            <Path id={`${id}-arc`} d={arcPath(c, c, r, 252, 216)} />
          </Defs>
          <SvgText
            fill={colors.brass}
            fontFamily={fonts.legend}
            fontSize={LEGEND_PX}
            letterSpacing={1.6}
            textAnchor="middle"
          >
            <TextPath href={`#${id}-arc`} startOffset="50%">
              {strings.home.dialLegend.toUpperCase()}
            </TextPath>
          </SvgText>
        </>
      )}
      {pair ? (
        <>
          <SvgText
            x={c}
            y={c + size * 0.235}
            fill={colors.textSubtle}
            fontFamily={fonts.legend}
            fontSize={LEGEND_PX}
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
        <>
          {below.map(({ x, text }) => (
            <SvgText
              key={text}
              x={x}
              y={L.belowLegendY}
              fill={colors.textMuted}
              fontFamily={fonts.legend}
              fontSize={LEGEND_PX}
              letterSpacing={Math.min(1.8, tracked(text, L.belowLegendY, 1.8, x))}
              textAnchor="middle"
            >
              {text}
            </SvgText>
          ))}
          <SvgText
            x={c}
            y={L.bottomLegendY}
            fill={colors.textSubtle}
            fontFamily={fonts.legend}
            fontSize={LEGEND_PX}
            letterSpacing={tracked(unpaired, L.bottomLegendY, 2.4)}
            textAnchor="middle"
          >
            {unpaired}
          </SvgText>
        </>
      )}
    </Svg>
  );
});

/**
 * A dotted half-link that draws in from its outer end (scaleX about that end: native driver). Broken (not paired):
 * only the outer 60 % is dotted, in textSubtle, so the two halves stop short of each other with a clear gap.
 */
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
  const stub = broken ? width * 0.6 : width;
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

  const { sub, offset, cy } = heroLayout(size, pair !== null);
  const gap = offset * 2 - sub;
  // Not paired: no medallion, so the two halves share the whole gap (the break is their inner 40 %).
  const medalSize = pair ? 24 : 0;
  const halfWidth = Math.max(8, (gap - medalSize) / 2 - 2);
  const medalScale = medal.interpolate({ inputRange: [0, 1], outputRange: [0.8, 1] });

  // Paired: the initial and its legend inside the sub-dial, tracking fitted to the chord at the legend's line.
  // Empty: a large "?" alone; the legend is engraved under the dial (Engraving).
  const monogram = (initial: string | null, legend: string) => (
    <SubDial size={sub} dashed={!initial}>
      <AppText
        variant="title"
        color={initial ? colors.brassLight : colors.textSubtle}
        maxFontSizeMultiplier={1}
        style={{
          fontSize: Math.round(sub * (initial ? 0.34 : 0.4)),
          lineHeight: Math.round(sub * (initial ? 0.4 : 0.46)),
        }}
      >
        {initial ?? '?'}
      </AppText>
      {initial ? (
        <AppText
          variant="dialLegend"
          maxFontSizeMultiplier={1}
          numberOfLines={1}
          style={{ letterSpacing: legendTracking(legend, sub, sub * 0.2) }}
        >
          {legend}
        </AppText>
      ) : null}
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
                marginHorizontal: pair ? 2 : 0,
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
