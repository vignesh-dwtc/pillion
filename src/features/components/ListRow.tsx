import { Pressable, View } from 'react-native';

import { borderWidth, colors, hit, radius, spacing } from '../../app/theme';

import { AppText } from './AppText';
import { Icon, type IconName } from './Icon';

/** A tappable row that leads to another screen: icon, title, optional hint and a chevron. */
export function ListRow({
  title,
  hint,
  icon,
  onPress,
  testID,
}: {
  title: string;
  hint?: string;
  icon?: IconName;
  onPress: () => void;
  testID?: string;
}) {
  return (
    <Pressable
      testID={testID}
      role="button"
      aria-label={hint ? `${title}. ${hint}` : title}
      onPress={onPress}
      style={({ pressed }) => ({
        minHeight: hit.large,
        flexDirection: 'row',
        alignItems: 'center',
        gap: spacing.md,
        paddingHorizontal: spacing.lg,
        paddingVertical: spacing.md,
        backgroundColor: colors.surfaceRaised,
        borderColor: colors.border,
        borderWidth: borderWidth.regular,
        borderRadius: radius.md,
        opacity: pressed ? 0.8 : 1,
      })}
    >
      {icon ? <Icon name={icon} size={28} color={colors.text} /> : null}
      <View style={{ flex: 1 }}>
        <AppText variant="bodyLarge" style={{ fontWeight: '700' }}>
          {title}
        </AppText>
        {hint ? (
          <AppText variant="label" color={colors.textMuted}>
            {hint}
          </AppText>
        ) : null}
      </View>
      <Icon name="chevron" size={26} color={colors.textMuted} />
    </Pressable>
  );
}
