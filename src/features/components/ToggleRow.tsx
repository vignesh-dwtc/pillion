import { Pressable, View } from 'react-native';

import { borderWidth, colors, hit, radius, spacing } from '../../app/theme';
import { strings } from '../../app/strings';

import { AppText } from './AppText';
import { Icon } from './Icon';

const TRACK_WIDTH = 84;
const TRACK_HEIGHT = 44;
const THUMB = 32;

/**
 * Labelled on/off row. The whole row is the touch target (>= 72 dp). The state is shown by the thumb position, the
 * "On"/"Off" word in the track and a check mark: never by colour alone.
 */
export function ToggleRow({
  label,
  hint,
  value,
  onValueChange,
  disabled = false,
  testID,
}: {
  label: string;
  hint?: string;
  value: boolean;
  onValueChange: (value: boolean) => void;
  disabled?: boolean;
  testID?: string;
}) {
  return (
    <Pressable
      testID={testID}
      role="switch"
      aria-label={label}
      aria-checked={value}
      aria-disabled={disabled || undefined}
      disabled={disabled}
      onPress={() => onValueChange(!value)}
      style={({ pressed }) => ({
        minHeight: hit.large - 8,
        flexDirection: 'row',
        alignItems: 'center',
        gap: spacing.lg,
        paddingVertical: spacing.sm,
        opacity: disabled ? 0.5 : pressed ? 0.8 : 1,
      })}
    >
      <View style={{ flex: 1, gap: 2 }}>
        <AppText variant="bodyLarge" style={{ fontWeight: '700' }}>
          {label}
        </AppText>
        {hint ? (
          <AppText variant="label" color={colors.textMuted}>
            {hint}
          </AppText>
        ) : null}
      </View>
      <View
        style={{
          width: TRACK_WIDTH,
          height: TRACK_HEIGHT,
          borderRadius: radius.pill,
          borderWidth: borderWidth.regular,
          borderColor: value ? colors.primary : colors.border,
          backgroundColor: value ? colors.primary : colors.surfaceRaised,
          justifyContent: 'center',
        }}
      >
        <AppText
          variant="label"
          color={value ? colors.onPrimary : colors.textMuted}
          style={{
            position: 'absolute',
            ...(value ? { left: spacing.md } : { right: spacing.md }),
            fontWeight: '800',
          }}
        >
          {value ? strings.common.on : strings.common.off}
        </AppText>
        <View
          style={{
            position: 'absolute',
            ...(value ? { right: 4 } : { left: 4 }),
            width: THUMB,
            height: THUMB,
            borderRadius: THUMB / 2,
            backgroundColor: value ? colors.onPrimary : colors.textMuted,
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          {value ? <Icon name="check" size={20} color={colors.primary} strokeWidth={3} /> : null}
        </View>
      </View>
    </Pressable>
  );
}
