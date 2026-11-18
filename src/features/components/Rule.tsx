import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

import { colors } from '../../app/theme';

/** Decorative hairline rule (never a component boundary). */
export function Rule({ style, color = colors.hairline }: { style?: StyleProp<ViewStyle>; color?: string }) {
  return <View style={[{ height: StyleSheet.hairlineWidth * 2, backgroundColor: color }, style]} />;
}

/** A short brass rule with a centre diamond: section ornament. */
export function Ornament({ width = 72 }: { width?: number }) {
  return (
    <View
      aria-hidden
      importantForAccessibility="no-hide-descendants"
      style={{ flexDirection: 'row', alignItems: 'center', alignSelf: 'center', width, gap: 6 }}
    >
      <View style={{ flex: 1, height: 1, backgroundColor: colors.brassShadow }} />
      <View
        style={{ width: 5, height: 5, transform: [{ rotate: '45deg' }], backgroundColor: colors.brass }}
      />
      <View style={{ flex: 1, height: 1, backgroundColor: colors.brassShadow }} />
    </View>
  );
}
