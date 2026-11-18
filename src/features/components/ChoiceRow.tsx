import { Pressable, View } from 'react-native';

import { colors, hit, spacing } from '../../app/theme';

import { AppText } from './AppText';
import { Icon } from './Icon';

export interface Choice<T extends string | number> {
  value: T;
  label: string;
  /** Spoken label when the visible one is terse (for example "20" for "20 milliseconds"). */
  accessibilityLabel?: string;
  testID?: string;
}

/**
 * One-of-N selector of 56 dp cells. The selected cell has a brass frame, a raised fill and a check mark: never
 * colour alone.
 */
export function ChoiceRow<T extends string | number>({
  label,
  hint,
  choices,
  value,
  onChange,
  testID,
}: {
  label: string;
  hint?: string;
  choices: readonly Choice<T>[];
  value: T;
  onChange: (value: T) => void;
  testID?: string;
}) {
  return (
    <View testID={testID} role="radiogroup" aria-label={label} style={{ gap: spacing.sm }}>
      <AppText variant="bodyLarge">{label}</AppText>
      {hint ? (
        <AppText variant="caption" color={colors.textSubtle}>
          {hint}
        </AppText>
      ) : null}
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm }}>
        {choices.map((choice) => {
          const selected = choice.value === value;
          return (
            <Pressable
              key={String(choice.value)}
              testID={choice.testID}
              role="radio"
              aria-label={choice.accessibilityLabel ?? choice.label}
              aria-checked={selected}
              onPress={() => onChange(choice.value)}
              style={({ pressed }) => ({
                flexGrow: 1,
                minWidth: hit.control + 8,
                minHeight: hit.control,
                flexDirection: 'row',
                alignItems: 'center',
                justifyContent: 'center',
                gap: spacing.xs,
                paddingHorizontal: spacing.md,
                borderWidth: selected ? 1.5 : 1,
                borderColor: selected ? colors.brass : colors.border,
                backgroundColor: selected || pressed ? colors.surfaceRaised : 'transparent',
              })}
            >
              {selected ? <Icon name="check" size={16} color={colors.brass} strokeWidth={2} /> : null}
              <AppText variant="value" color={selected ? colors.brass : colors.text}>
                {choice.label}
              </AppText>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}
