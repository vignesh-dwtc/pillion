import type { ReactNode } from 'react';
import { View, type StyleProp, type ViewStyle } from 'react-native';

import { borderWidth, colors, radius, spacing, toneColor, type Tone } from '../../app/theme';

import { AppText } from './AppText';
import { Icon, type IconName } from './Icon';

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
    <View
      testID={testID}
      style={[
        {
          backgroundColor: colors.surface,
          borderRadius: radius.lg,
          borderWidth: borderWidth.thin,
          borderColor: colors.border,
          padding: spacing.lg,
          gap: spacing.md,
        },
        style,
      ]}
    >
      {children}
    </View>
  );
}

export function SectionHeading({ children, testID }: { children: string; testID?: string }) {
  return (
    <AppText
      variant="heading"
      role="heading"
      aria-level={2}
      testID={testID}
      style={{ marginTop: spacing.sm }}
    >
      {children}
    </AppText>
  );
}

const TONE_ICON: Record<Tone, IconName> = {
  neutral: 'info',
  success: 'check',
  warning: 'alert',
  danger: 'close',
  info: 'info',
};

/** Status chip: icon + text + border, so the state never relies on colour alone. */
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
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        alignSelf: 'flex-start',
        gap: spacing.sm,
        borderColor: color,
        borderWidth: borderWidth.regular,
        borderRadius: radius.pill,
        paddingVertical: spacing.sm,
        paddingHorizontal: spacing.md,
      }}
    >
      <Icon name={icon ?? TONE_ICON[tone]} size={20} color={color} />
      <AppText variant="label" color={color} style={{ flexShrink: 1 }}>
        {label}
      </AppText>
    </View>
  );
}

/** Dashed box that marks placeholder content: not a real result, never mistaken for live data. */
export function Banner({ children, testID }: { children: string; testID?: string }) {
  return (
    <View
      testID={testID}
      role="note"
      style={{
        flexDirection: 'row',
        gap: spacing.md,
        alignItems: 'flex-start',
        borderWidth: borderWidth.regular,
        borderStyle: 'dashed',
        borderColor: colors.warning,
        borderRadius: radius.md,
        padding: spacing.md,
      }}
    >
      <Icon name="info" size={24} color={colors.warning} />
      <AppText variant="label" color={colors.text} style={{ flex: 1 }}>
        {children}
      </AppText>
    </View>
  );
}

export function Divider() {
  return <View style={{ height: borderWidth.thin, backgroundColor: colors.border, opacity: 0.6 }} />;
}
