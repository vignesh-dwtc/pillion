import { View } from 'react-native';
import Svg, { Path } from 'react-native-svg';

import { borderWidth, colors, radius, spacing } from '../../app/theme';
import { AppText } from '../components/AppText';
import { Icon } from '../components/Icon';

/**
 * Placeholder for the camera preview on the guest pairing screen: a square frame with corner brackets. The real
 * `expo-camera` preview replaces the inside in the pairing milestone and keeps the same frame.
 */
export function Viewfinder({
  size,
  title,
  note,
  accessibilityLabel,
  testID,
}: {
  size: number;
  title: string;
  note: string;
  accessibilityLabel: string;
  testID?: string;
}) {
  const arm = size * 0.16;
  const inset = 14;
  const far = size - inset;
  const corners = [
    `M${inset} ${inset + arm}V${inset}H${inset + arm}`,
    `M${far - arm} ${inset}H${far}V${inset + arm}`,
    `M${far} ${far - arm}V${far}H${far - arm}`,
    `M${inset + arm} ${far}H${inset}V${far - arm}`,
  ];
  return (
    <View
      testID={testID}
      role="img"
      aria-label={accessibilityLabel}
      style={{
        width: size,
        height: size,
        alignSelf: 'center',
        borderRadius: radius.lg,
        borderWidth: borderWidth.regular,
        borderColor: colors.border,
        borderStyle: 'dashed',
        backgroundColor: colors.surface,
        alignItems: 'center',
        justifyContent: 'center',
        padding: spacing.xl,
        gap: spacing.md,
      }}
    >
      <View style={{ position: 'absolute', left: 0, top: 0 }}>
        <Svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
          {corners.map((d) => (
            <Path
              key={d}
              d={d}
              stroke={colors.text}
              strokeWidth={6}
              strokeLinecap="round"
              strokeLinejoin="round"
              fill="none"
            />
          ))}
        </Svg>
      </View>
      <Icon name="camera" size={56} color={colors.textMuted} />
      <AppText variant="bodyLarge" align="center" style={{ fontWeight: '700' }}>
        {title}
      </AppText>
      <AppText variant="label" align="center" color={colors.textMuted}>
        {note}
      </AppText>
    </View>
  );
}
