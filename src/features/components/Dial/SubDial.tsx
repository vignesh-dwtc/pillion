import { memo, type ReactNode } from 'react';
import { View, type StyleProp, type ViewStyle } from 'react-native';
import Svg, { Circle, Path } from 'react-native-svg';

import { colors, type as typeScale } from '../../../app/theme';
import { AppText } from '../AppText';

import { arcPath, ticksPath } from './geometry';

const SubDialArt = memo(function SubDialArt({
  size,
  level,
  levelColor,
  dashed,
}: {
  size: number;
  level: number | null;
  levelColor: string;
  dashed: boolean;
}) {
  const c = size / 2;
  const rim = c - 1;
  const arcR = rim - 5;
  return (
    <Svg width={size} height={size} style={{ position: 'absolute', left: 0, top: 0 }}>
      <Circle
        cx={c}
        cy={c}
        r={rim}
        fill={colors.face}
        stroke={colors.brassShadow}
        strokeWidth={1.2}
        strokeDasharray={dashed ? '2 3' : undefined}
      />
      <Circle cx={c} cy={c} r={rim - 2.5} fill="none" stroke={colors.hairline} strokeWidth={0.8} />
      <Path
        d={ticksPath(c, c, rim - 3, rim - 6, 12, 0, 30)}
        stroke={colors.brassShadow}
        strokeWidth={1}
        strokeLinecap="round"
      />
      {level !== null ? (
        <>
          <Path
            d={arcPath(c, c, arcR, 225, 270)}
            stroke={colors.hairline}
            strokeWidth={2.4}
            strokeLinecap="round"
            fill="none"
          />
          {level > 0.005 ? (
            <Path
              d={arcPath(c, c, arcR, 225, 270 * Math.min(1, level))}
              stroke={levelColor}
              strokeWidth={2.4}
              strokeLinecap="round"
              fill="none"
            />
          ) : null}
        </>
      ) : null}
    </Svg>
  );
});

/**
 * Small inset dial: a dark face with a brassShadow rim and 12 ticks, an optional 0..1 level arc, and a centred
 * value with an engraved legend (dialLegend 10, always next to a value of 15 or more). `children` replaces the value
 * (monograms). The text is exposed through `accessibilityLabel` on the parent, so the dial itself is decorative.
 */
export function SubDial({
  size,
  value,
  unit,
  legend,
  level = null,
  levelColor = colors.brass,
  valueColor = colors.text,
  dashed = false,
  children,
  style,
}: {
  size: number;
  value?: string;
  unit?: string;
  legend?: string;
  level?: number | null;
  levelColor?: string;
  valueColor?: string;
  dashed?: boolean;
  children?: ReactNode;
  style?: StyleProp<ViewStyle>;
}) {
  return (
    <View
      aria-hidden
      accessible={false}
      importantForAccessibility="no-hide-descendants"
      pointerEvents="none"
      style={[{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }, style]}
    >
      <SubDialArt size={size} level={level} levelColor={levelColor} dashed={dashed} />
      {children ?? (
        <>
          <View style={{ flexDirection: 'row', alignItems: 'baseline' }}>
            <AppText
              variant="value"
              color={valueColor}
              maxFontSizeMultiplier={1.15}
              style={{ fontSize: size > 70 ? 17 : 15 }}
            >
              {value ?? ''}
            </AppText>
            {unit ? (
              <AppText
                variant="dialLegend"
                color={colors.textMuted}
                style={{ marginLeft: 2, textTransform: 'none', letterSpacing: 0 }}
              >
                {unit}
              </AppText>
            ) : null}
          </View>
          {legend ? (
            <AppText
              variant="dialLegend"
              style={{ marginTop: 1, letterSpacing: typeScale.dialLegend.letterSpacing }}
            >
              {legend}
            </AppText>
          ) : null}
        </>
      )}
    </View>
  );
}
