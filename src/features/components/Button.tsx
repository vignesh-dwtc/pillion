import { Plate, type PlateVariant } from './Plate';
import type { IconName } from './Icon';

export type ButtonVariant = 'primary' | 'secondary' | 'danger' | 'ghost';
/** md 56 dp, lg 76 dp, ride 124 dp. */
export type ButtonSize = 'md' | 'lg' | 'ride';

const VARIANT: Record<ButtonVariant, PlateVariant> = {
  primary: 'brass',
  secondary: 'outline',
  danger: 'oxblood',
  ghost: 'outline',
};
const SIZE = { md: 'control', lg: 'primary', ride: 'ride' } as const;

export interface ButtonProps {
  label: string;
  onPress: () => void;
  testID?: string;
  variant?: ButtonVariant;
  size?: ButtonSize;
  icon?: IconName;
  hint?: string;
  disabled?: boolean;
  busy?: boolean;
  accessibilityLabel?: string;
  chevron?: boolean;
  grow?: boolean;
}

/** A labelled chamfered plate. Every button has a text label, an accessible name and a role. */
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
  chevron,
  grow,
}: ButtonProps) {
  return (
    <Plate
      label={label}
      sub={hint}
      onPress={onPress}
      testID={testID}
      variant={VARIANT[variant]}
      size={SIZE[size]}
      icon={icon}
      disabled={disabled || busy}
      accessibilityLabel={accessibilityLabel}
      chevron={chevron}
      grow={grow}
    />
  );
}
