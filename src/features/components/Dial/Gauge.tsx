import { memo, useEffect, useRef, useState } from 'react';
import { Animated, View } from 'react-native';
import { useAnimatedValue } from '../motion/useAnimatedValue';
import Svg, { Circle, Defs, LinearGradient, Path, Stop, Text as SvgText } from 'react-native-svg';

import { strings } from '../../../app/strings';
import { colors, fonts, type as typeScale, tracking } from '../../../app/theme';
import { AppText } from '../AppText';
import { Icon } from '../Icon';
import { duration, ease, needleSpring } from '../motion/tokens';
import { useAppActive } from '../motion/useAppActive';
import { useReducedMotion } from '../motion/useReducedMotion';

import { BezelRing, BezelTicks, DialLayer } from './Bezel';
import { GAUGE_START, GAUGE_SWEEP, arcPath, gaugeLayout, ticksPath } from './geometry';
import { Guilloche } from './Guilloche';
import { SubDial } from './SubDial';

const AnimatedPath = Animated.createAnimatedComponent(Path);

export type GaugeState = 'linked' | 'connecting' | 'reconnecting' | 'idle';

let gaugeIds = 0;

/** Pointer updates are rate-limited: the needle moves at most every 2 s while riding. */
const POINTER_MIN_INTERVAL_MS = 2000;

const gaugeMetrics = gaugeLayout;

const GaugeStatic = memo(function GaugeStatic({ size, id }: { size: number; id: string }) {
  const g = gaugeMetrics(size);
  const inner = ticksPath(g.c, g.c, g.arcR - 9, g.arcR - 14, 27, GAUGE_START, GAUGE_SWEEP / 26);
  return (
    <Svg width={size} height={size} style={{ position: 'absolute', left: 0, top: 0 }}>
      <Path
        d={arcPath(g.c, g.c, g.arcR, GAUGE_START, GAUGE_SWEEP)}
        stroke={colors.face}
        strokeWidth={8}
        strokeLinecap="round"
        fill="none"
      />
      <Path
        d={arcPath(g.c, g.c, g.arcR, GAUGE_START, GAUGE_SWEEP)}
        stroke={colors.hairline}
        strokeWidth={6}
        strokeLinecap="round"
        fill="none"
      />
      <Path d={inner} stroke={colors.brassShadow} strokeWidth={1} strokeLinecap="round" />
      <SvgText
        x={g.c}
        y={g.c + g.arcR * 0.86}
        fill={colors.textSubtle}
        fontFamily={fonts.legend}
        fontSize={10}
        letterSpacing={2.4}
        textAnchor="middle"
      >
        {strings.ride.gaugeLegend.toUpperCase()}
      </SvgText>
      <Defs>
        <LinearGradient id={`${id}-arc`} x1="0" y1="1" x2="1" y2="0">
          <Stop offset="0" stopColor={colors.brassDeep} />
          <Stop offset="1" stopColor={colors.brassLight} />
        </LinearGradient>
      </Defs>
    </Svg>
  );
});

const Pointer = memo(function Pointer({ size }: { size: number }) {
  const g = gaugeMetrics(size);
  const tip = g.c - g.arcR - g.pointerTip;
  const tail = g.c - g.arcR + g.pointerTail;
  return (
    <Svg width={size} height={size}>
      <Path
        d={`M${g.c} ${tip}L${g.c + 3} ${tail}L${g.c - 3} ${tail}Z`}
        fill={colors.brassLight}
        stroke={colors.onBrass}
        strokeWidth={0.6}
      />
      <Circle
        cx={g.c}
        cy={g.c - g.arcR}
        r={6}
        fill={colors.face}
        stroke={colors.brassLight}
        strokeWidth={1.6}
      />
      <Circle cx={g.c} cy={g.c - g.arcR} r={2} fill={colors.brassLight} />
    </Svg>
  );
});

/** Spinner medallion for "connecting": a light native-driver rotation that stops off-screen and under reduced motion. */
function Spinner({ color, active }: { color: string; active: boolean }) {
  const turn = useAnimatedValue(0);
  useEffect(() => {
    if (!active) return;
    const loop = Animated.loop(
      Animated.timing(turn, { toValue: 1, duration: 1400, easing: ease, useNativeDriver: true }),
    );
    loop.start();
    return () => loop.stop();
  }, [active, turn]);
  const rotate = turn.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '360deg'] });
  return (
    <Animated.View style={{ transform: [{ rotate }] }}>
      <Svg width={14} height={14} viewBox="0 0 24 24">
        <Path d="M12 3a9 9 0 1 1-9 9" stroke={color} strokeWidth={2.6} strokeLinecap="round" fill="none" />
      </Svg>
    </Animated.View>
  );
}

export interface RideGaugeProps {
  size: number;
  state: GaugeState;
  /** Link quality 0..1. */
  quality: number;
  rideTime: string;
  /** Round-trip delay in ms as text, or null when unknown (shown as an em dash, no unit). */
  delay: string | null;
  partnerBattery: number | null;
  accessibilityLabel: string;
  testID?: string;
}

/**
 * Ride gauge. Brass bezel and guilloche; a 270-degree link-quality arc (7:30 to 4:30) with a brass gradient value
 * (amber while reconnecting); 27 inner ticks and a ringed brassLight pointer; the state legend with a check,
 * spinner or triangle medallion; the ride time; and two sub-dials (delay, partner battery).
 *
 * Ignition (mount): the gauge scales 0.9 to 1 and fades in (420 ms), the pointer self-tests 0 -> full -> value
 * (900 ms), the legend tracking tightens 0.6 -> 0.3 em (300 ms). Link-up: when the state becomes linked the arc
 * draws in from both ends (700 ms). Riding: the pointer eases (spring, < 3 % overshoot) at most every 2 s.
 * Reconnecting: the pointer steps. Reduced motion: values jump, only crossfades.
 */
export function RideGauge({
  size,
  state,
  quality,
  rideTime,
  delay,
  partnerBattery,
  accessibilityLabel,
  testID,
}: RideGaugeProps) {
  const reduced = useReducedMotion();
  const active = useAppActive();
  const [id] = useState(() => `gauge${++gaugeIds}`);
  const g = gaugeMetrics(size);

  const enter = useAnimatedValue(reduced ? 1 : 0);
  const value = useAnimatedValue(reduced ? quality : 0);
  const legendTrack = useAnimatedValue(reduced ? 1 : 0);
  const linkUp = useAnimatedValue(1);
  const lastPointerAt = useRef(0);
  const pendingTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const prevState = useRef(state);
  const ignited = useRef(false);

  // Ignition: once.
  useEffect(() => {
    if (reduced) {
      enter.setValue(1);
      legendTrack.setValue(1);
      value.setValue(quality);
      ignited.current = true;
      lastPointerAt.current = Date.now();
      return;
    }
    const sequence = Animated.parallel([
      Animated.timing(enter, {
        toValue: 1,
        duration: duration.entrance,
        easing: ease,
        useNativeDriver: false,
      }),
      Animated.timing(legendTrack, {
        toValue: 1,
        duration: 300,
        delay: 120,
        easing: ease,
        useNativeDriver: false,
      }),
      Animated.sequence([
        Animated.timing(value, { toValue: 1, duration: 450, easing: ease, useNativeDriver: false }),
        Animated.timing(value, { toValue: quality, duration: 450, easing: ease, useNativeDriver: false }),
      ]),
    ]);
    sequence.start(() => {
      ignited.current = true;
      lastPointerAt.current = Date.now();
    });
    return () => sequence.stop();
    // Ignition runs once on mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Pointer follows the quality, rate-limited; steps while reconnecting; jumps under reduced motion.
  useEffect(() => {
    if (!ignited.current) return;
    const move = () => {
      lastPointerAt.current = Date.now();
      if (reduced || state === 'reconnecting' || !active) {
        value.setValue(state === 'reconnecting' ? Math.round(quality * 10) / 10 : quality);
        return;
      }
      Animated.spring(value, { toValue: quality, ...needleSpring, useNativeDriver: false }).start();
    };
    const wait = POINTER_MIN_INTERVAL_MS - (Date.now() - lastPointerAt.current);
    if (pendingTimer.current) clearTimeout(pendingTimer.current);
    if (wait <= 0) move();
    else pendingTimer.current = setTimeout(move, wait);
    return () => {
      if (pendingTimer.current) clearTimeout(pendingTimer.current);
    };
  }, [quality, state, reduced, active, value]);

  // Link-up: the arc draws in from both ends when the state becomes linked.
  useEffect(() => {
    const was = prevState.current;
    prevState.current = state;
    if (state !== 'linked' || was === 'linked') return;
    if (reduced) {
      linkUp.setValue(1);
      return;
    }
    linkUp.setValue(0);
    Animated.timing(linkUp, { toValue: 1, duration: 700, easing: ease, useNativeDriver: false }).start();
  }, [state, reduced, linkUp]);

  const warn = state === 'reconnecting';
  const arcStroke = warn ? colors.amber : `url(#${id}-arc)`;
  const dashOffset = value.interpolate({ inputRange: [0, 1], outputRange: [g.arcLen, 0] });
  const half = g.arcLen / 2;
  const linkOffset = linkUp.interpolate({ inputRange: [0, 1], outputRange: [half, 0] });
  const linkOpacity = linkUp.interpolate({ inputRange: [0, 0.85, 1], outputRange: [1, 1, 0] });
  const rotate = value.interpolate({
    inputRange: [0, 1],
    outputRange: [`${GAUGE_START}deg`, `${GAUGE_START + GAUGE_SWEEP}deg`],
  });
  const scale = enter.interpolate({ inputRange: [0, 1], outputRange: [0.9, 1] });
  const fontSize = typeScale.legend.fontSize;
  const letterSpacing = legendTrack.interpolate({
    inputRange: [0, 1],
    outputRange: [tracking(fontSize, 0.6), tracking(fontSize, 0.3)],
  });

  const tone = state === 'linked' ? colors.patina : warn ? colors.amber : colors.brass;
  const legend =
    state === 'linked'
      ? strings.ride.gaugeLinked
      : state === 'reconnecting'
        ? strings.ride.gaugeReconnecting
        : state === 'connecting'
          ? strings.ride.gaugeConnecting
          : strings.ride.gaugeIdle;

  const sub = g.sub.r * 2;
  const midHalf = arcPath(g.c, g.c, g.arcR, GAUGE_START, GAUGE_SWEEP / 2);
  const midHalfReverse = `M${arcEnd(g, GAUGE_START + GAUGE_SWEEP)}A${g.arcR} ${g.arcR} 0 0 0 ${arcEnd(g, GAUGE_START + GAUGE_SWEEP / 2)}`;

  return (
    <Animated.View
      testID={testID}
      role="progressbar"
      aria-label={accessibilityLabel}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(quality * 100)}
      style={{ width: size, height: size, alignSelf: 'center', opacity: enter, transform: [{ scale }] }}
    >
      <DialLayer size={size}>
        <BezelRing size={size} id={id} />
        <Guilloche size={size} radius={g.face} settle={false} />
        <BezelTicks size={size} animateIn={false} />
        <GaugeStatic size={size} id={id} />
        <Svg width={size} height={size} style={{ position: 'absolute', left: 0, top: 0 }}>
          <Defs>
            <LinearGradient id={`${id}-arc`} x1="0" y1="1" x2="1" y2="0">
              <Stop offset="0" stopColor={colors.brassDeep} />
              <Stop offset="1" stopColor={colors.brassLight} />
            </LinearGradient>
          </Defs>
          <AnimatedPath
            d={arcPath(g.c, g.c, g.arcR, GAUGE_START, GAUGE_SWEEP)}
            stroke={arcStroke}
            strokeWidth={6}
            strokeLinecap="round"
            fill="none"
            strokeDasharray={[g.arcLen, g.arcLen]}
            strokeDashoffset={dashOffset}
          />
          <AnimatedPath
            d={midHalf}
            stroke={colors.brassLight}
            strokeWidth={2}
            strokeLinecap="round"
            fill="none"
            strokeDasharray={[half, half]}
            strokeDashoffset={linkOffset}
            opacity={linkOpacity}
          />
          <AnimatedPath
            d={midHalfReverse}
            stroke={colors.brassLight}
            strokeWidth={2}
            strokeLinecap="round"
            fill="none"
            strokeDasharray={[half, half]}
            strokeDashoffset={linkOffset}
            opacity={linkOpacity}
          />
        </Svg>
        <Animated.View
          style={{
            position: 'absolute',
            left: 0,
            top: 0,
            width: size,
            height: size,
            transform: [{ rotate }],
          }}
        >
          <Pointer size={size} />
        </Animated.View>

        <View
          style={{
            position: 'absolute',
            left: 0,
            right: 0,
            top: g.c - size * 0.25,
            alignItems: 'center',
          }}
        >
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
            <View
              style={{
                width: 22,
                height: 22,
                borderRadius: 11,
                borderWidth: 1,
                borderColor: tone,
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              {state === 'linked' ? (
                <Icon name="check" size={13} color={tone} strokeWidth={2} />
              ) : warn ? (
                <Icon name="warning-triangle" size={13} color={tone} strokeWidth={2} />
              ) : (
                <Spinner color={tone} active={active && !reduced && state === 'connecting'} />
              )}
            </View>
            <Animated.Text
              allowFontScaling
              maxFontSizeMultiplier={1.15}
              style={[typeScale.legend, { color: tone, letterSpacing }]}
            >
              {legend}
            </Animated.Text>
          </View>
          <AppText variant="gaugeNumeral" style={{ marginTop: 4 }}>
            {rideTime}
          </AppText>
          <AppText
            variant="legend"
            maxFontSizeMultiplier={1}
            style={{ fontSize: 11, letterSpacing: tracking(11, 0.24) }}
          >
            {strings.ride.rideTime}
          </AppText>
        </View>

        <SubDial
          size={sub}
          value={delay ?? strings.common.unknownValue}
          unit={delay === null ? undefined : strings.ride.msUnit}
          legend={strings.ride.delayLegend}
          style={{
            position: 'absolute',
            left: g.sub.left.x - sub / 2,
            top: g.sub.left.y - sub / 2,
          }}
        />
        <SubDial
          size={sub}
          value={partnerBattery === null ? strings.common.unknownValue : String(partnerBattery)}
          unit={partnerBattery === null ? undefined : '%'}
          legend={strings.ride.batteryLegend}
          level={partnerBattery === null ? null : partnerBattery / 100}
          levelColor={partnerBattery !== null && partnerBattery <= 20 ? colors.amber : colors.brass}
          style={{
            position: 'absolute',
            left: g.sub.right.x - sub / 2,
            top: g.sub.right.y - sub / 2,
          }}
        />
      </DialLayer>
    </Animated.View>
  );
}

function arcEnd(g: { c: number; arcR: number }, angle: number): string {
  const a = ((angle - 90) * Math.PI) / 180;
  return `${Math.round((g.c + g.arcR * Math.cos(a)) * 100) / 100} ${Math.round((g.c + g.arcR * Math.sin(a)) * 100) / 100}`;
}
