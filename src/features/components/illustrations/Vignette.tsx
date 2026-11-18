import { memo, type ReactNode } from 'react';
import { View } from 'react-native';
import Svg, { Circle, Defs, G, Path, RadialGradient, Rect, Stop } from 'react-native-svg';

import { colors } from '../../../app/theme';

import { EarbudsArt } from './Earbuds';
import { PocketPhoneArt } from './PocketPhone';

export type VignetteKind = 'microphone' | 'nearby' | 'notifications' | 'earbuds' | 'pocket';

const line = { strokeLinecap: 'round', strokeLinejoin: 'round', fill: 'none' } as const;

function Art({ kind }: { kind: VignetteKind }): ReactNode {
  switch (kind) {
    case 'microphone':
      return (
        <G>
          <Rect
            x={50}
            y={30}
            width={20}
            height={36}
            rx={10}
            stroke={colors.text}
            strokeWidth={1.4}
            {...line}
          />
          <Path d="M54 40h12M54 47h12M54 54h12" stroke={colors.brassShadow} strokeWidth={1} {...line} />
          <Path
            d="M40 58a20 20 0 0 0 40 0M60 78v10M50 88h20"
            stroke={colors.text}
            strokeWidth={1.4}
            {...line}
          />
          <Path
            d="M30 40a32 32 0 0 0 0 30M90 40a32 32 0 0 1 0 30"
            stroke={colors.brass}
            strokeWidth={1.2}
            {...line}
          />
          <Path
            d="M22 34a42 42 0 0 0 0 42M98 34a42 42 0 0 1 0 42"
            stroke={colors.brass}
            strokeWidth={1}
            strokeOpacity={0.55}
            {...line}
          />
        </G>
      );
    case 'nearby':
      return (
        <G>
          <Rect
            x={18}
            y={38}
            width={24}
            height={44}
            rx={4}
            stroke={colors.text}
            strokeWidth={1.4}
            {...line}
          />
          <Rect
            x={78}
            y={38}
            width={24}
            height={44}
            rx={4}
            stroke={colors.text}
            strokeWidth={1.4}
            {...line}
          />
          <Path d="M27 76h6M87 76h6" stroke={colors.textSubtle} strokeWidth={1.2} {...line} />
          <Path
            d="M52 62a10 10 0 0 1 16 0M47 55a17 17 0 0 1 26 0M42 48a24 24 0 0 1 36 0"
            stroke={colors.brass}
            strokeWidth={1.2}
            {...line}
          />
          <Circle cx={60} cy={68} r={1.8} fill={colors.brass} />
        </G>
      );
    case 'notifications':
      return (
        <G>
          <Path d="M40 76V56a20 20 0 0 1 40 0v20l6 8H34z" stroke={colors.text} strokeWidth={1.4} {...line} />
          <Path d="M53 90a7 7 0 0 0 14 0M60 30v6" stroke={colors.text} strokeWidth={1.4} {...line} />
          <Path
            d="M30 46a34 34 0 0 1 8-12M90 46a34 34 0 0 0-8-12"
            stroke={colors.brass}
            strokeWidth={1.2}
            {...line}
          />
          <Path d="M46 62h28" stroke={colors.brassShadow} strokeWidth={1} {...line} />
        </G>
      );
    case 'earbuds':
      return <EarbudsArt />;
    case 'pocket':
      return <PocketPhoneArt />;
  }
}

/**
 * Engraved onboarding vignette (120 dp): a medallion with a brass rim, an inner hairline, a cupped face and line
 * art in the same hand as the night-road etching. Decorative.
 */
export const Vignette = memo(function Vignette({ kind, size = 120 }: { kind: VignetteKind; size?: number }) {
  return (
    <View
      aria-hidden
      accessible={false}
      importantForAccessibility="no-hide-descendants"
      pointerEvents="none"
      style={{ width: size, height: size, alignSelf: 'center' }}
    >
      <Svg width={size} height={size} viewBox="0 0 120 120">
        <Defs>
          <RadialGradient id="vg-face" cx="50%" cy="40%" r="60%">
            <Stop offset="0" stopColor={colors.surfaceRaised} />
            <Stop offset="1" stopColor={colors.bg} />
          </RadialGradient>
        </Defs>
        <Circle cx={60} cy={60} r={58} fill="url(#vg-face)" stroke={colors.brassDeep} strokeWidth={1.2} />
        <Circle
          cx={60}
          cy={60}
          r={54}
          fill="none"
          stroke={colors.brassShadow}
          strokeWidth={0.8}
          strokeDasharray="1 3"
        />
        <Art kind={kind} />
      </Svg>
    </View>
  );
});
