import { Pressable, StyleSheet, View } from 'react-native';

import { colors, hit, spacing } from '../../app/theme';

import { AppText } from './AppText';
import { Icon, type IconName } from './Icon';

/** 56 dp hairline row that leads to another screen: brass icon, title, optional hint/value and a chevron. */
export function ListRow({
  title,
  hint,
  value,
  valueColor = colors.textMuted,
  icon,
  iconColor = colors.brass,
  onPress,
  testID,
  last = false,
}: {
  title: string;
  hint?: string;
  value?: string;
  valueColor?: string;
  icon?: IconName;
  iconColor?: string;
  onPress: () => void;
  testID?: string;
  /** Draws the closing hairline under the row. */
  last?: boolean;
}) {
  const spoken = [title, value, hint].filter(Boolean).join('. ');
  return (
    <Pressable
      testID={testID}
      role="button"
      aria-label={spoken}
      onPress={onPress}
      style={({ pressed }) => ({
        minHeight: hit.row,
        flexDirection: 'row',
        alignItems: 'center',
        gap: spacing.md,
        paddingVertical: spacing.sm,
        paddingHorizontal: spacing.xs,
        borderTopWidth: StyleSheet.hairlineWidth * 2,
        borderBottomWidth: last ? StyleSheet.hairlineWidth * 2 : 0,
        borderColor: colors.hairline,
        backgroundColor: pressed ? colors.surfaceRaised : 'transparent',
      })}
    >
      {icon ? <Icon name={icon} size={20} color={iconColor} /> : null}
      <View style={{ flex: 1, gap: 1 }}>
        <AppText variant="bodyLarge">{title}</AppText>
        {hint ? (
          <AppText variant="caption" color={colors.textSubtle}>
            {hint}
          </AppText>
        ) : null}
      </View>
      {value ? (
        <AppText variant="value" color={valueColor}>
          {value}
        </AppText>
      ) : null}
      <Icon name="chevron" size={18} color={colors.textSubtle} />
    </Pressable>
  );
}
