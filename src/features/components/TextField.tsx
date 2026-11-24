import { useState } from 'react';
import { TextInput, View } from 'react-native';

import { colors, hit, spacing, type as typeScale } from '../../app/theme';

import { AppText } from './AppText';

/**
 * Engraved text field: a label, an optional hint and a 56 dp+ input that sits on a hairline (brass when focused),
 * with no auto-correct surprises.
 */
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
  secure = false,
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
  /** Masks the value (pasted pairing strings): never drawn as readable text, kept out of the keyboard's memory. */
  secure?: boolean;
}) {
  const [focused, setFocused] = useState(false);
  return (
    <View style={{ gap: spacing.xs }}>
      <AppText variant="legend">{label}</AppText>
      {hint ? (
        <AppText variant="caption" color={colors.textSubtle}>
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
        multiline={multiline && !secure}
        secureTextEntry={secure}
        onFocus={() => setFocused(true)}
        onBlur={() => {
          setFocused(false);
          onBlur?.();
        }}
        onSubmitEditing={onSubmitEditing}
        returnKeyType={multiline ? 'default' : 'done'}
        autoCapitalize={autoCapitalize}
        autoCorrect={false}
        spellCheck={false}
        autoComplete="off"
        importantForAutofill="no"
        selectionColor={colors.brass}
        allowFontScaling
        maxFontSizeMultiplier={1.6}
        style={[
          typeScale.bodyLarge,
          {
            minHeight: multiline ? hit.control * 2 : hit.control,
            color: colors.text,
            backgroundColor: colors.surface,
            borderBottomWidth: focused ? 2 : 1,
            borderColor: focused ? colors.brass : colors.border,
            paddingHorizontal: spacing.md,
            paddingVertical: spacing.md,
            textAlignVertical: multiline ? 'top' : 'center',
          },
        ]}
      />
    </View>
  );
}
