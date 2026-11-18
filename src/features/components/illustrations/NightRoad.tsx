import { memo } from 'react';
import { View } from 'react-native';
import Svg, { Circle, Defs, G, LinearGradient, Path, RadialGradient, Rect, Stop } from 'react-native-svg';

import { colors } from '../../../app/theme';

import { MotorcycleRear } from './Motorcycle';

const STARS = [
  [34, 22, 0.9],
  [72, 48, 0.6],
  [118, 18, 0.8],
  [156, 40, 0.5],
  [212, 14, 0.7],
  [238, 52, 0.5],
  [326, 30, 0.8],
  [344, 72, 0.5],
  [20, 78, 0.5],
  [96, 84, 0.4],
] as const;

/** Road centre dashes in perspective: [y, length]. */
const DASHES = [
  [140, 7],
  [126, 5],
  [117, 3.5],
  [111, 2.4],
] as const;

/**
 * Night-road etching: horizon, two hill ranges, a crescent moon, a road converging to the horizon with brass centre
 * dashes, the motorcycle from behind with rider and pillion, a brass taillight glow, and a fade into the background.
 * Ivory and brass line art in a 360 x 200 drawing, scaled to cover `width` x `height`. Decorative and static.
 */
export const NightRoad = memo(function NightRoad({
  width,
  height,
  fade = true,
}: {
  width: number;
  height: number;
  fade?: boolean;
}) {
  const line = { strokeLinecap: 'round', strokeLinejoin: 'round', fill: 'none' } as const;
  return (
    <View
      aria-hidden
      accessible={false}
      importantForAccessibility="no-hide-descendants"
      pointerEvents="none"
      style={{ width, height }}
    >
      <Svg width={width} height={height} viewBox="0 0 360 200" preserveAspectRatio="xMidYMid slice">
        <Defs>
          <RadialGradient id="nr-glow" cx="50%" cy="50%" r="50%">
            <Stop offset="0" stopColor={colors.brass} stopOpacity={0.55} />
            <Stop offset="1" stopColor={colors.brass} stopOpacity={0} />
          </RadialGradient>
          <RadialGradient id="nr-moon" cx="50%" cy="50%" r="50%">
            <Stop offset="0" stopColor={colors.brassLight} stopOpacity={0.18} />
            <Stop offset="1" stopColor={colors.brassLight} stopOpacity={0} />
          </RadialGradient>
          <LinearGradient id="nr-fade" x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0" stopColor={colors.bg} stopOpacity={0} />
            <Stop offset="1" stopColor={colors.bg} stopOpacity={1} />
          </LinearGradient>
          <LinearGradient id="nr-fade-top" x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0" stopColor={colors.bg} stopOpacity={1} />
            <Stop offset="1" stopColor={colors.bg} stopOpacity={0} />
          </LinearGradient>
        </Defs>

        {STARS.map(([x, y, o]) => (
          <Circle key={`${x}-${y}`} cx={x} cy={y} r={0.9} fill={colors.text} opacity={o * 0.7} />
        ))}

        {/* crescent moon with a halo */}
        <Circle cx={292} cy={44} r={34} fill="url(#nr-moon)" />
        <Path
          d="M300 30a15 15 0 1 0 0 28 12 12 0 1 1 0-28z"
          stroke={colors.brassLight}
          strokeWidth={1.2}
          {...line}
        />

        {/* hill ranges and horizon */}
        <Path
          d="M0 94C30 82 54 74 86 80S140 64 176 74 236 58 268 70 330 66 360 78"
          stroke={colors.textSubtle}
          strokeWidth={0.9}
          strokeOpacity={0.7}
          {...line}
        />
        <Path
          d="M0 102C40 92 70 98 104 90S160 96 190 98 250 86 290 94 340 92 360 96"
          stroke={colors.textMuted}
          strokeWidth={1}
          strokeOpacity={0.85}
          {...line}
        />
        <Path d="M0 104H360" stroke={colors.textMuted} strokeWidth={0.8} strokeOpacity={0.6} {...line} />
        {/* engraved hatching on the near hills */}
        <Path
          d="M24 100l6-5M40 99l6-5M300 98l6-4M316 98l6-4M332 98l6-4M64 99l6-5"
          stroke={colors.textSubtle}
          strokeWidth={0.6}
          strokeOpacity={0.6}
          {...line}
        />

        {/* road */}
        <Path d="M178 105L20 200H340L182 105Z" fill={colors.surface} fillOpacity={0.9} />
        <Path d="M178 105L20 200M182 105L340 200" stroke={colors.text} strokeWidth={1.2} {...line} />
        <Path
          d="M176 107L80 200M184 107L280 200"
          stroke={colors.textSubtle}
          strokeWidth={0.5}
          strokeOpacity={0.5}
          strokeDasharray="2 4"
          {...line}
        />
        {DASHES.map(([y, len]) => (
          <Path
            key={y}
            d={`M180 ${y}v${-len}`}
            stroke={colors.brass}
            strokeWidth={Math.max(0.8, len / 7)}
            {...line}
          />
        ))}

        {/* motorcycle with rider and pillion, taillight glow */}
        <Circle cx={180} cy={172} r={30} fill="url(#nr-glow)" />
        <G transform="translate(152 128) scale(0.94)">
          <MotorcycleRear />
        </G>

        {fade ? (
          <>
            <Rect x={0} y={176} width={360} height={24} fill="url(#nr-fade)" />
            <Rect x={0} y={0} width={360} height={24} fill="url(#nr-fade-top)" />
          </>
        ) : null}
      </Svg>
    </View>
  );
});
