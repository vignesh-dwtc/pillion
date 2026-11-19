import { Pressable } from 'react-native';
import Svg, { Circle, Defs, RadialGradient, Stop } from 'react-native-svg';

import { colors, hit } from '../../app/theme';

import { Icon, type IconName } from './Icon';

const SLOP = (56 - hit.min) / 2;

/**
 * 48 dp icon ring: a 1 px border circle with a cupped-metal radial fill (raised to bg), hitSlop to 56. Always has an
 * accessible name.
 */
export function RingButton({
  icon,
  label,
  onPress,
  testID,
  color = colors.brass,
}: {
  icon: IconName;
  label: string;
  onPress: () => void;
  testID?: string;
  color?: string;
}) {
  const size = hit.min;
  return (
    <Pressable
      testID={testID}
      role="button"
      aria-label={label}
      onPress={onPress}
      hitSlop={SLOP}
      style={({ pressed }) => ({
        width: size,
        height: size,
        alignItems: 'center',
        justifyContent: 'center',
        opacity: pressed ? 0.75 : 1,
        transform: [{ scale: pressed ? 0.96 : 1 }],
      })}
    >
      <Svg width={size} height={size} style={{ position: 'absolute' }}>
        <Defs>
          <RadialGradient id="cup" cx="50%" cy="38%" r="60%">
            <Stop offset="0" stopColor={colors.surfaceRaised} />
            <Stop offset="1" stopColor={colors.bg} />
          </RadialGradient>
        </Defs>
        <Circle cx={size / 2} cy={size / 2} r={size / 2 - 0.5} fill="url(#cup)" stroke={colors.border} />
      </Svg>
      <Icon name={icon} size={22} color={color} />
    </Pressable>
  );
}
