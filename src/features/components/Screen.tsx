import { useIsFocused } from '@react-navigation/native';
import type { ReactNode } from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { strings } from '../../app/strings';
import { borderWidth, colors, contentMaxWidth, hit, radius, spacing } from '../../app/theme';

import { AppText } from './AppText';
import { Icon } from './Icon';

/**
 * Common screen frame: black background, edge-to-edge safe-area insets, a header with a 56 dp+ back button and a
 * centred, width-limited content column. `testID` goes on the root so every screen has a stable `screen-*` id.
 */
export function Screen({
  testID,
  title,
  onBack,
  children,
  footer,
  scroll = true,
  subtitle,
}: {
  testID: string;
  title: string;
  /** Omit on screens without a back button (home, ride). */
  onBack?: () => void;
  children: ReactNode;
  /** Pinned above the bottom inset, outside the scroll area. */
  footer?: ReactNode;
  /** false: no scrolling, the content column fills the screen (ride). */
  scroll?: boolean;
  subtitle?: string;
}) {
  const insets = useSafeAreaInsets();
  // Screens below the top of the stack stay mounted (and in the DOM on web), so only the visible one carries the
  // shared `btn-back` test id: exactly one match at any time.
  const focused = useIsFocused();
  const column = {
    width: '100%',
    maxWidth: contentMaxWidth,
    alignSelf: 'center',
  } as const;

  // The header scrolls away with the content: on a small phone a pinned back button, title and subtitle would
  // take a quarter of the screen. The system back gesture and button always work, and the footer stays pinned.
  const header = (
    <View style={[column, { gap: spacing.xs, paddingTop: spacing.md, paddingBottom: spacing.sm }]}>
      {onBack ? <BackButton onPress={onBack} testID={focused ? 'btn-back' : undefined} /> : null}
      <AppText variant="title" role="heading" aria-level={1} testID={`${testID}-title`}>
        {title}
      </AppText>
      {subtitle ? (
        <AppText variant="body" color={colors.textMuted}>
          {subtitle}
        </AppText>
      ) : null}
    </View>
  );

  const body = scroll ? (
    <ScrollView
      style={{ flex: 1 }}
      contentContainerStyle={{
        flexGrow: 1,
        paddingHorizontal: spacing.lg,
        paddingBottom: spacing.xl + (footer ? 0 : insets.bottom),
      }}
      keyboardShouldPersistTaps="handled"
    >
      {header}
      <View style={[column, { gap: spacing.lg, flexGrow: 1 }]}>{children}</View>
    </ScrollView>
  ) : (
    <View
      style={{
        flex: 1,
        paddingHorizontal: spacing.lg,
        paddingBottom: footer ? 0 : insets.bottom + spacing.lg,
      }}
    >
      {header}
      <View style={[column, { flex: 1, gap: spacing.lg }]}>{children}</View>
    </View>
  );

  return (
    <View
      testID={testID}
      style={{
        flex: 1,
        backgroundColor: colors.bg,
        paddingTop: insets.top,
        paddingLeft: insets.left,
        paddingRight: insets.right,
      }}
    >
      {body}
      {footer ? (
        <View
          style={{
            paddingHorizontal: spacing.lg,
            paddingTop: spacing.md,
            paddingBottom: spacing.md + insets.bottom,
            borderTopWidth: borderWidth.thin,
            borderTopColor: colors.border,
            backgroundColor: colors.bg,
          }}
        >
          <View style={[column, { gap: spacing.md }]}>{footer}</View>
        </View>
      ) : null}
    </View>
  );
}

function BackButton({ onPress, testID }: { onPress: () => void; testID?: string }) {
  return (
    <Pressable
      testID={testID}
      role="button"
      aria-label={strings.common.backLabel}
      onPress={onPress}
      style={({ pressed }) => ({
        alignSelf: 'flex-start',
        minHeight: hit.min,
        minWidth: hit.min,
        flexDirection: 'row',
        alignItems: 'center',
        gap: spacing.sm,
        paddingHorizontal: spacing.md,
        marginLeft: -spacing.md,
        borderRadius: radius.md,
        opacity: pressed ? 0.7 : 1,
      })}
    >
      <Icon name="back" size={28} />
      <AppText variant="bodyLarge" style={{ fontWeight: '600' }}>
        {strings.common.back}
      </AppText>
    </Pressable>
  );
}
