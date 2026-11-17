import { Pressable, View } from 'react-native';

import { borderWidth, colors, hit, radius, spacing } from '../../app/theme';

import { AppText } from './AppText';
import { Icon } from './Icon';

/**
 * Number adjuster with two big buttons instead of a slider: no drag precision needed with gloves. The value is a
 * live region so a screen reader announces each change.
 */
export function Stepper({
  label,
  hint,
  valueText,
  onDecrement,
  onIncrement,
  decrementDisabled = false,
  incrementDisabled = false,
  decrementLabel,
  incrementLabel,
  testID,
}: {
  label: string;
  hint?: string;
  valueText: string;
  onDecrement: () => void;
  onIncrement: () => void;
  decrementDisabled?: boolean;
  incrementDisabled?: boolean;
  decrementLabel: string;
  incrementLabel: string;
  testID?: string;
}) {
  return (
    <View testID={testID} style={{ gap: spacing.sm }}>
      <AppText variant="bodyLarge" style={{ fontWeight: '700' }}>
        {label}
      </AppText>
      {hint ? (
        <AppText variant="label" color={colors.textMuted}>
          {hint}
        </AppText>
      ) : null}
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.md }}>
        <StepButton
          icon="minus"
          label={decrementLabel}
          disabled={decrementDisabled}
          onPress={onDecrement}
          testID={testID ? `${testID}-down` : undefined}
        />
        <View
          style={{
            flex: 1,
            minHeight: hit.control,
            alignItems: 'center',
            justifyContent: 'center',
            borderRadius: radius.md,
            borderWidth: borderWidth.regular,
            borderColor: colors.border,
            backgroundColor: colors.bg,
          }}
        >
          <AppText
            variant="heading"
            aria-live="polite"
            testID={testID ? `${testID}-value` : undefined}
            style={{ fontVariant: ['tabular-nums'] }}
          >
            {valueText}
          </AppText>
        </View>
        <StepButton
          icon="plus"
          label={incrementLabel}
          disabled={incrementDisabled}
          onPress={onIncrement}
          testID={testID ? `${testID}-up` : undefined}
        />
      </View>
    </View>
  );
}

function StepButton({
  icon,
  label,
  disabled,
  onPress,
  testID,
}: {
  icon: 'minus' | 'plus';
  label: string;
  disabled: boolean;
  onPress: () => void;
  testID?: string;
}) {
  return (
    <Pressable
      testID={testID}
      role="button"
      aria-label={label}
      aria-disabled={disabled || undefined}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => ({
        width: hit.control,
        height: hit.control,
        alignItems: 'center',
        justifyContent: 'center',
        borderRadius: radius.md,
        borderWidth: borderWidth.regular,
        borderColor: colors.border,
        backgroundColor: colors.surfaceRaised,
        opacity: disabled ? 0.4 : pressed ? 0.75 : 1,
      })}
    >
      <Icon name={icon} size={30} color={colors.text} strokeWidth={3} />
    </Pressable>
  );
}
