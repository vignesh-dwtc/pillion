import { Platform, Text, type TextProps, type TextStyle } from 'react-native';

import { colors, maxFontScale, type as typeScale, type TypeVariant } from '../../app/theme';

const MONO_FONT = Platform.select({ ios: 'Menlo', default: 'monospace' });

export interface AppTextProps extends TextProps {
  variant?: TypeVariant;
  /** A colour from the theme (`colors.*` or `toneColor.*`). */
  color?: string;
  align?: TextStyle['textAlign'];
}

/** The only text component screens use: applies the type scale, theme colour and a cap on font scaling. */
export function AppText({
  variant = 'body',
  color = colors.text,
  align,
  style,
  maxFontSizeMultiplier,
  ...rest
}: AppTextProps) {
  return (
    <Text
      {...rest}
      maxFontSizeMultiplier={maxFontSizeMultiplier ?? maxFontScale[variant]}
      style={[
        typeScale[variant],
        variant === 'mono' ? { fontFamily: MONO_FONT } : null,
        { color },
        align ? { textAlign: align } : null,
        style,
      ]}
    />
  );
}
