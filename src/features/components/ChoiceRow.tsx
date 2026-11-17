import { Pressable, View } from 'react-native';

import { borderWidth, colors, hit, radius, spacing } from '../../app/theme';

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
 * One-of-N selector made of big buttons. The selected one is marked by a check mark, a thick white border and a
 * lighter fill, not by colour alone.
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
      <AppText variant="bodyLarge" style={{ fontWeight: '700' }}>
        {label}
      </AppText>
      {hint ? (
        <AppText variant="label" color={colors.textMuted}>
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
                minWidth: hit.min + 24,
                minHeight: hit.min,
                flexDirection: 'row',
                alignItems: 'center',
                justifyContent: 'center',
                gap: spacing.xs,
                paddingHorizontal: spacing.md,
                borderRadius: radius.md,
                borderWidth: selected ? borderWidth.thick : borderWidth.regular,
                borderColor: selected ? colors.focus : colors.border,
                backgroundColor: selected ? colors.surfaceSelected : colors.surfaceRaised,
                opacity: pressed ? 0.8 : 1,
              })}
            >
              {selected ? <Icon name="check" size={20} color={colors.focus} strokeWidth={3} /> : null}
              <AppText variant="bodyLarge" style={{ fontWeight: selected ? '800' : '500' }}>
                {choice.label}
              </AppText>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}
