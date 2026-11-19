import type { ReactNode } from 'react';
import { View } from 'react-native';
import Svg, { Circle, Defs, G, Line, LinearGradient, Path, Stop } from 'react-native-svg';

import { colors, spacing } from '../../app/theme';
import { AppText } from '../components/AppText';
import { Icon } from '../components/Icon';
import { chamferPath } from '../components/Plate';
import { polar } from '../components/Dial/geometry';

const SCREW_ANGLES = [41, 133, 77, 168];

/**
 * Guest viewfinder: a chamfered brass bezel with corner screws around the camera area and an engraved scan line.
 * With `live` content (the camera preview) the window is cut out of the bezel and the preview shows through it,
 * under the brass corner marks; without it the window is an enamel face with an icon, a title and a note.
 */
export function Viewfinder({
  size,
  title,
  note,
  icon = 'camera',
  accessibilityLabel,
  testID,
  live,
}: {
  size: number;
  title?: string;
  note?: string;
  icon?: 'camera' | 'check' | 'warning-triangle' | 'shield-check';
  accessibilityLabel: string;
  testID?: string;
  /** The live camera preview, drawn under the bezel inside the window. */
  live?: ReactNode;
}) {
  const frame = 16;
  const screws = [
    { x: 15, y: 15 },
    { x: size - 15, y: 15 },
    { x: 15, y: size - 15 },
    { x: size - 15, y: size - 15 },
  ];
  const inner = size - 2 * frame;
  const arm = inner * 0.14;
  const a = frame + 10;
  const b = size - frame - 10;
  return (
    <View
      testID={testID}
      role="img"
      aria-label={accessibilityLabel}
      style={{
        width: size,
        height: size,
        alignSelf: 'center',
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      {live ? (
        <View
          style={{
            position: 'absolute',
            left: frame,
            top: frame,
            width: inner,
            height: inner,
            overflow: 'hidden',
            backgroundColor: colors.face,
          }}
        >
          {live}
        </View>
      ) : null}
      <Svg width={size} height={size} style={{ position: 'absolute', left: 0, top: 0 }} pointerEvents="none">
        <Defs>
          <LinearGradient id="vf-brass" x1="0" y1="0" x2="1" y2="1">
            <Stop offset="0" stopColor={colors.brassLight} />
            <Stop offset="0.5" stopColor={colors.brassDeep} />
            <Stop offset="1" stopColor={colors.brassShadow} />
          </LinearGradient>
        </Defs>
        {live ? (
          // Bezel with a window: outer and inner outline in one path, the window left open (even-odd).
          <Path
            d={`${chamferPath(size, size, 20, 0.5)}${chamferPath(size, size, 14, frame)}`}
            fill="url(#vf-brass)"
            fillRule="evenodd"
            stroke={colors.brassDeep}
          />
        ) : (
          <Path d={chamferPath(size, size, 20, 0.5)} fill="url(#vf-brass)" stroke={colors.brassDeep} />
        )}
        <Path
          d={chamferPath(size, size, 14, frame)}
          fill={live ? 'none' : colors.face}
          stroke={colors.onBrass}
          strokeOpacity={0.6}
        />
        {screws.map((s, i) => {
          const p = polar(s.x, s.y, 3.6, SCREW_ANGLES[i] ?? 0);
          const q = polar(s.x, s.y, 3.6, (SCREW_ANGLES[i] ?? 0) + 180);
          return (
            <G key={i}>
              <Circle
                cx={s.x}
                cy={s.y}
                r={4.2}
                fill={colors.brassLight}
                stroke={colors.onBrass}
                strokeOpacity={0.5}
                strokeWidth={0.8}
              />
              <Line
                x1={p.x}
                y1={p.y}
                x2={q.x}
                y2={q.y}
                stroke={colors.onBrass}
                strokeWidth={1.1}
                strokeLinecap="round"
              />
            </G>
          );
        })}
        {[
          `M${a} ${a + arm}V${a}H${a + arm}`,
          `M${b - arm} ${a}H${b}V${a + arm}`,
          `M${b} ${b - arm}V${b}H${b - arm}`,
          `M${a + arm} ${b}H${a}V${b - arm}`,
        ].map((d) => (
          <Path
            key={d}
            d={d}
            stroke={colors.brass}
            strokeWidth={2}
            strokeLinecap="round"
            strokeLinejoin="round"
            fill="none"
          />
        ))}
        <Line
          x1={a + 6}
          y1={size / 2}
          x2={b - 6}
          y2={size / 2}
          stroke={colors.brass}
          strokeOpacity={0.55}
          strokeWidth={1}
          strokeDasharray="6 4"
        />
        <Path d={`M${a} ${size / 2 - 4}l5 4-5 4zM${b} ${size / 2 - 4}l-5 4 5 4z`} fill={colors.brass} />
      </Svg>
      {live ? null : (
        <View
          style={{
            alignItems: 'center',
            gap: spacing.sm,
            paddingHorizontal: spacing.xxl,
            marginTop: -size * 0.22,
          }}
        >
          <Icon name={icon} size={32} color={colors.textMuted} />
          {title ? (
            <AppText variant="bodyLarge" align="center">
              {title}
            </AppText>
          ) : null}
        </View>
      )}
      {!live && note ? (
        <View style={{ position: 'absolute', bottom: frame + 18, left: frame + 20, right: frame + 20 }}>
          <AppText variant="caption" align="center" color={colors.textSubtle}>
            {note}
          </AppText>
        </View>
      ) : null}
    </View>
  );
}
