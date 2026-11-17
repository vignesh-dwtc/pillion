import { Pressable, View } from 'react-native';

import { borderWidth, colors, hit, radius, spacing } from '../../app/theme';

import { AppText } from './AppText';
import { Icon, type IconName } from './Icon';

export type ButtonVariant = 'primary' | 'secondary' | 'danger' | 'warning' | 'ghost';
/** md >= 64 dp, lg 80 dp, ride >= 132 dp (the ride controls must be at least 96 dp). */
export type ButtonSize = 'md' | 'lg' | 'ride';

const VARIANTS: Record<ButtonVariant, { bg: string; fg: string; border: string }> = {
  primary: { bg: colors.primary, fg: colors.onPrimary, border: colors.primary },
  secondary: { bg: colors.surfaceRaised, fg: colors.text, border: colors.border },
  danger: { bg: colors.dangerSolid, fg: colors.onDangerSolid, border: colors.dangerSolid },
  warning: { bg: colors.warning, fg: colors.onWarning, border: colors.warning },
  ghost: { bg: 'transparent', fg: colors.text, border: colors.border },
};

const MIN_HEIGHT: Record<ButtonSize, number> = { md: hit.control, lg: hit.large, ride: hit.rideHeight };
const ICON_SIZE: Record<ButtonSize, number> = { md: 28, lg: 32, ride: 56 };
const LABEL_VARIANT = { md: 'bodyLarge', lg: 'heading', ride: 'display' } as const;

export interface ButtonProps {
  label: string;
  onPress: () => void;
  testID?: string;
  variant?: ButtonVariant;
  size?: ButtonSize;
  icon?: IconName;
  /** Smaller second line under the label. */
  hint?: string;
  disabled?: boolean;
  busy?: boolean;
  /** Overrides the spoken label (defaults to the visible label plus the hint). */
  accessibilityLabel?: string;
  /** 'switch' for on/off buttons such as Mute; pair it with `checked`. */
  role?: 'button' | 'switch';
  checked?: boolean;
  /** Content alignment; rows that lead into another screen read better left aligned. */
  align?: 'center' | 'start';
  grow?: boolean;
}

/** Large, high-contrast touch target. Every button has a text label, an accessible name and a role. */
export function Button({
  label,
  onPress,
  testID,
  variant = 'secondary',
  size = 'md',
  icon,
  hint,
  disabled = false,
  busy = false,
  accessibilityLabel,
  role = 'button',
  checked,
  align = 'center',
  grow = false,
}: ButtonProps) {
  const colorSet = VARIANTS[variant];
  const spoken = accessibilityLabel ?? (hint ? `${label}. ${hint}` : label);
  return (
    <Pressable
      testID={testID}
      role={role}
      aria-label={spoken}
      aria-disabled={disabled || undefined}
      aria-busy={busy || undefined}
      aria-checked={role === 'switch' ? checked : undefined}
      disabled={disabled || busy}
      onPress={onPress}
      style={({ pressed }) => [
        {
          minHeight: MIN_HEIGHT[size],
          minWidth: hit.min,
          backgroundColor: colorSet.bg,
          borderColor: colorSet.border,
          borderWidth: borderWidth.regular,
          borderRadius: size === 'ride' ? radius.lg : radius.md,
          paddingHorizontal: spacing.lg,
          paddingVertical: spacing.md,
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: align === 'center' ? 'center' : 'flex-start',
          gap: spacing.md,
          opacity: disabled ? 0.45 : pressed ? 0.8 : 1,
        },
        grow ? { flex: 1 } : null,
      ]}
    >
      {icon ? <Icon name={icon} size={ICON_SIZE[size]} color={colorSet.fg} /> : null}
      <View style={{ flexShrink: 1, alignItems: align === 'center' ? 'center' : 'flex-start' }}>
        <AppText
          variant={LABEL_VARIANT[size]}
          color={colorSet.fg}
          align={align === 'center' ? 'center' : 'left'}
          style={{ fontWeight: '700' }}
        >
          {label}
        </AppText>
        {hint ? (
          <AppText variant="label" color={colorSet.fg} align={align === 'center' ? 'center' : 'left'}>
            {hint}
          </AppText>
        ) : null}
      </View>
    </Pressable>
  );
}
