import { View } from 'react-native';

import { colors, hit, spacing } from '../../app/theme';

import { AppText } from './AppText';
import { Plate } from './Plate';

/**
 * Number adjuster with two 56 dp brass minus/plus plates instead of a slider (no drag precision with gloves). The
 * tabular value is a live region so a screen reader announces each change.
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
      <AppText variant="bodyLarge">{label}</AppText>
      {hint ? (
        <AppText variant="caption" color={colors.textSubtle}>
          {hint}
        </AppText>
      ) : null}
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.md }}>
        <View style={{ width: hit.control + 8 }}>
          <Plate
            testID={testID ? `${testID}-down` : undefined}
            label=""
            icon="minus"
            size="control"
            variant="brass"
            layout="stack"
            accessibilityLabel={decrementLabel}
            disabled={decrementDisabled}
            onPress={onDecrement}
          />
        </View>
        <View
          style={{
            flex: 1,
            minHeight: hit.control,
            alignItems: 'center',
            justifyContent: 'center',
            borderTopWidth: 1,
            borderBottomWidth: 1,
            borderColor: colors.hairline,
          }}
        >
          <AppText
            variant="value"
            aria-live="polite"
            testID={testID ? `${testID}-value` : undefined}
            style={{ fontSize: 19, lineHeight: 24 }}
          >
            {valueText}
          </AppText>
        </View>
        <View style={{ width: hit.control + 8 }}>
          <Plate
            testID={testID ? `${testID}-up` : undefined}
            label=""
            icon="plus"
            size="control"
            variant="brass"
            layout="stack"
            accessibilityLabel={incrementLabel}
            disabled={incrementDisabled}
            onPress={onIncrement}
          />
        </View>
      </View>
    </View>
  );
}
