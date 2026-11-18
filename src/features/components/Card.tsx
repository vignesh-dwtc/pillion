import type { ReactNode } from 'react';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

import { colors, spacing, toneColor, type Tone } from '../../app/theme';

import { AppText, Legend } from './AppText';
import { Icon, type IconName } from './Icon';
import { Rule } from './Rule';

/** A group of content: no box, just spacing (hairline-ruled lists replace boxed cards). */
export function Card({
  children,
  style,
  testID,
}: {
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}) {
  return (
    <View testID={testID} style={[{ gap: spacing.md }, style]}>
      {children}
    </View>
  );
}

/** Section legend: engraved Marcellus SC with a hairline running to the edge. */
export function SectionHeading({
  children,
  testID,
  icon,
  color = colors.textSubtle,
}: {
  children: string;
  testID?: string;
  icon?: IconName;
  color?: string;
}) {
  return (
    <View
      style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginTop: spacing.md }}
      testID={testID}
    >
      {icon ? <Icon name={icon} size={16} color={color} /> : null}
      <Legend color={color} style={{ flexShrink: 1 }}>
        {children}
      </Legend>
      <Rule style={{ flex: 1 }} />
    </View>
  );
}

export const TONE_ICON: Record<Tone, IconName> = {
  neutral: 'info',
  success: 'check',
  warning: 'warning-triangle',
  danger: 'cross',
  info: 'info',
};

/** Status: a tone ring with an icon, and the word. Never colour alone. */
export function StatusPill({
  tone,
  label,
  icon,
  testID,
}: {
  tone: Tone;
  label: string;
  icon?: IconName;
  testID?: string;
}) {
  const color = toneColor[tone];
  return (
    <View
      testID={testID}
      style={{ flexDirection: 'row', alignItems: 'center', alignSelf: 'flex-start', gap: spacing.sm }}
    >
      <View
        style={{
          width: 26,
          height: 26,
          borderRadius: 13,
          borderWidth: 1,
          borderColor: color,
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <Icon name={icon ?? TONE_ICON[tone]} size={14} color={color} strokeWidth={1.8} />
      </View>
      <AppText variant="bodyLarge" color={color} style={{ flexShrink: 1 }}>
        {label}
      </AppText>
    </View>
  );
}

/** A note framed by hairlines with a tone icon: placeholder notices and warnings. */
export function Banner({
  children,
  testID,
  tone = 'warning',
}: {
  children: string;
  testID?: string;
  tone?: Tone;
}) {
  const color = toneColor[tone];
  return (
    <View
      testID={testID}
      role="note"
      style={{
        flexDirection: 'row',
        gap: spacing.md,
        alignItems: 'flex-start',
        paddingVertical: spacing.md,
        paddingHorizontal: spacing.md,
        borderLeftWidth: 2,
        borderLeftColor: color,
        borderTopWidth: StyleSheet.hairlineWidth * 2,
        borderBottomWidth: StyleSheet.hairlineWidth * 2,
        borderTopColor: colors.hairline,
        borderBottomColor: colors.hairline,
        backgroundColor: colors.surface,
      }}
    >
      <Icon name={TONE_ICON[tone]} size={18} color={color} />
      <AppText variant="body" color={colors.textMuted} style={{ flex: 1 }}>
        {children}
      </AppText>
    </View>
  );
}

export function Divider() {
  return <Rule />;
}
