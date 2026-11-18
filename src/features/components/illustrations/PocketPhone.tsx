import { G, Path, Rect } from 'react-native-svg';

import { colors } from '../../../app/theme';

const line = { strokeLinecap: 'round', strokeLinejoin: 'round', fill: 'none' } as const;

/** A phone tucked in a jacket pocket, screen dark (120 x 120 drawing). */
export function PocketPhoneArt() {
  return (
    <G>
      <Rect x={44} y={24} width={32} height={56} rx={5} stroke={colors.text} strokeWidth={1.4} {...line} />
      <Path d="M56 30h8" stroke={colors.textSubtle} strokeWidth={1.2} {...line} />
      <Path
        d="M30 52h60v34a8 8 0 0 1-8 8H38a8 8 0 0 1-8-8z"
        stroke={colors.text}
        strokeWidth={1.4}
        fill={colors.surface}
      />
      <Path
        d="M34 57h52v28a5 5 0 0 1-5 5H39a5 5 0 0 1-5-5z"
        stroke={colors.brass}
        strokeWidth={0.9}
        strokeDasharray="2 2.5"
        {...line}
      />
      <Path d="M30 52c10 6 50 6 60 0" stroke={colors.text} strokeWidth={1.2} {...line} />
    </G>
  );
}
