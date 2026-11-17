import { TextInput, View } from 'react-native';

import { borderWidth, colors, hit, radius, spacing, type as typeScale } from '../../app/theme';

import { AppText } from './AppText';

/** Labelled single- or multi-line input with a 64 dp+ field, a visible label and no auto-correct surprises. */
export function TextField({
  label,
  hint,
  value,
  onChangeText,
  placeholder,
  testID,
  maxLength,
  multiline = false,
  onBlur,
  onSubmitEditing,
  autoCapitalize = 'none',
}: {
  label: string;
  hint?: string;
  value: string;
  onChangeText: (text: string) => void;
  placeholder?: string;
  testID?: string;
  maxLength?: number;
  multiline?: boolean;
  onBlur?: () => void;
  onSubmitEditing?: () => void;
  autoCapitalize?: 'none' | 'words' | 'sentences';
}) {
  return (
    <View style={{ gap: spacing.sm }}>
      <AppText variant="bodyLarge" style={{ fontWeight: '700' }}>
        {label}
      </AppText>
      {hint ? (
        <AppText variant="label" color={colors.textMuted}>
          {hint}
        </AppText>
      ) : null}
      <TextInput
        testID={testID}
        aria-label={label}
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={colors.textSubtle}
        maxLength={maxLength}
        multiline={multiline}
        onBlur={onBlur}
        onSubmitEditing={onSubmitEditing}
        returnKeyType={multiline ? 'default' : 'done'}
        autoCapitalize={autoCapitalize}
        autoCorrect={false}
        spellCheck={false}
        autoComplete="off"
        importantForAutofill="no"
        selectionColor={colors.primary}
        style={[
          typeScale.bodyLarge,
          {
            minHeight: multiline ? hit.control * 2 : hit.control,
            color: colors.text,
            backgroundColor: colors.bg,
            borderColor: colors.border,
            borderWidth: borderWidth.regular,
            borderRadius: radius.md,
            paddingHorizontal: spacing.lg,
            paddingVertical: spacing.md,
            textAlignVertical: multiline ? 'top' : 'center',
          },
        ]}
      />
    </View>
  );
}
