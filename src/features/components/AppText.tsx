import { Platform, StyleSheet, Text, type StyleProp, type TextProps, type TextStyle } from 'react-native';

import { webFontScale } from '../../app/preview';

import { colors, maxFontScale, type as typeScale, type TypeVariant } from '../../app/theme';

export interface AppTextProps extends TextProps {
  variant?: TypeVariant;
  /** A colour from the theme (`colors.*` or `toneColor.*`). */
  color?: string;
  align?: TextStyle['textAlign'];
}

const WEB_SCALE = Platform.OS === 'web' && webFontScale !== 1;

/** Web only: applies an emulated system font scale (see `webFontScale`). */
function emulateScale(style: TextStyle, scale: number): TextStyle {
  return {
    ...style,
    fontSize: style.fontSize === undefined ? undefined : style.fontSize * scale,
    lineHeight: style.lineHeight === undefined ? undefined : style.lineHeight * scale,
  };
}

const DEFAULT_COLOR: Partial<Record<TypeVariant, string>> = {
  legend: colors.textSubtle,
  dialLegend: colors.textSubtle,
  caption: colors.textSubtle,
  wordmark: colors.brass,
};

/**
 * The only text component screens use: applies the type scale (bundled faces, tabular numerals for data), the
 * theme colour and a per-variant cap on font scaling. Font scaling stays on.
 */
export function AppText({
  variant = 'body',
  color,
  align,
  style,
  maxFontSizeMultiplier,
  ...rest
}: AppTextProps) {
  const cap = maxFontSizeMultiplier ?? maxFontScale[variant];
  const composed: StyleProp<TextStyle> = [
    typeScale[variant],
    { color: color ?? DEFAULT_COLOR[variant] ?? colors.text },
    align ? { textAlign: align } : null,
    style,
  ];
  return (
    <Text
      {...rest}
      allowFontScaling
      maxFontSizeMultiplier={cap}
      style={
        WEB_SCALE ? emulateScale(StyleSheet.flatten(composed) ?? {}, Math.min(webFontScale, cap)) : composed
      }
    />
  );
}

/** Engraved legend (Marcellus SC, uppercase, tracked). */
export function Legend({
  children,
  color,
  align,
  testID,
  style,
}: {
  children: string;
  color?: string;
  align?: TextStyle['textAlign'];
  testID?: string;
  style?: TextProps['style'];
}) {
  return (
    <AppText variant="legend" color={color} align={align} testID={testID} style={style}>
      {children}
    </AppText>
  );
}
