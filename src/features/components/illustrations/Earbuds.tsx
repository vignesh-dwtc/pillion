import { G, Path } from 'react-native-svg';

import { colors } from '../../../app/theme';

const line = { strokeLinecap: 'round', strokeLinejoin: 'round', fill: 'none' } as const;

/** Two earbuds with sound lines, engraved (120 x 120 drawing). */
export function EarbudsArt() {
  return (
    <G>
      <Path
        d="M38 44a12 12 0 1 1 10 18v22a4 4 0 0 1-8 0V62"
        stroke={colors.text}
        strokeWidth={1.4}
        {...line}
      />
      <Path
        d="M82 44a12 12 0 1 0-10 18v22a4 4 0 0 0 8 0V62"
        stroke={colors.text}
        strokeWidth={1.4}
        {...line}
      />
      <Path d="M42 46a4 4 0 0 1 4-4M78 46a4 4 0 0 0-4-4" stroke={colors.brass} strokeWidth={1.2} {...line} />
      <Path
        d="M22 40a20 20 0 0 0 0 20M98 40a20 20 0 0 1 0 20"
        stroke={colors.brass}
        strokeWidth={1.1}
        {...line}
      />
    </G>
  );
}
