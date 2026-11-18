import { useIsFocused } from '@react-navigation/native';
import { memo, type ReactNode } from 'react';
import { ScrollView, StyleSheet, View, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Defs, RadialGradient, Rect, Stop } from 'react-native-svg';

import { strings } from '../../app/strings';
import { colors, contentMaxWidth, gutter, spacing } from '../../app/theme';

import { AppText, Legend } from './AppText';
import { Stagger } from './motion/Entrance';
import { RingButton } from './RingButton';

/** Decorative warm radial lift at the top of every screen (behind the header and hero dials). */
export const RadialLift = memo(function RadialLift({ height = 420 }: { height?: number }) {
  const { width } = useWindowDimensions();
  return (
    <View
      aria-hidden
      importantForAccessibility="no-hide-descendants"
      pointerEvents="none"
      style={{ position: 'absolute', left: 0, right: 0, top: 0, height }}
    >
      <Svg width={width} height={height}>
        <Defs>
          <RadialGradient id="lift" cx="50%" cy="18%" rx="75%" ry="70%">
            <Stop offset="0" stopColor={colors.bgLift} stopOpacity={1} />
            <Stop offset="1" stopColor={colors.bg} stopOpacity={0} />
          </RadialGradient>
        </Defs>
        <Rect x={0} y={0} width={width} height={height} fill="url(#lift)" />
      </Svg>
    </View>
  );
});

/**
 * Common screen frame: warm near-black background with a radial lift, edge-to-edge safe-area insets, 22 dp gutters,
 * a centred column (max 560), and a header made of a 48 dp ring button, an engraved eyebrow legend and a Marcellus
 * title. Children enter with a 60 ms stagger (fade + 8 dp rise; reduced motion: crossfade). `testID` goes on the
 * root so every screen has a stable `screen-*` id.
 */
export function Screen({
  testID,
  title,
  eyebrow,
  onBack,
  action,
  header,
  children,
  footer,
  scroll = true,
  subtitle,
}: {
  testID: string;
  title?: string;
  /** Legend above the title. */
  eyebrow?: string;
  /** Omit on screens without a back button (home, ride). */
  onBack?: () => void;
  /** Right-hand header element (a RingButton). */
  action?: ReactNode;
  /** Replaces the default header (home). */
  header?: ReactNode;
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
  const column = { width: '100%', maxWidth: contentMaxWidth, alignSelf: 'center' } as const;

  const defaultHeader = (
    <View style={{ gap: spacing.md, paddingTop: spacing.sm, paddingBottom: spacing.md }}>
      {onBack || action ? (
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
          {onBack ? (
            <RingButton
              icon="back"
              label={strings.common.backLabel}
              onPress={onBack}
              testID={focused ? 'btn-back' : undefined}
            />
          ) : (
            <View />
          )}
          {action ?? null}
        </View>
      ) : null}
      {title ? (
        <View style={{ gap: spacing.xs }}>
          {eyebrow ? <Legend color={colors.brass}>{eyebrow}</Legend> : null}
          <AppText variant="title" role="heading" aria-level={1} testID={`${testID}-title`}>
            {title}
          </AppText>
          {subtitle ? (
            <AppText variant="body" color={colors.textMuted}>
              {subtitle}
            </AppText>
          ) : null}
        </View>
      ) : null}
    </View>
  );

  const content = (
    <View style={[column, { gap: spacing.lg }, scroll ? { flexGrow: 1 } : { flex: 1 }]}>
      <Stagger>{children}</Stagger>
    </View>
  );

  const body = scroll ? (
    <ScrollView
      style={{ flex: 1, minHeight: 0 }}
      contentContainerStyle={{
        flexGrow: 1,
        paddingHorizontal: gutter,
        paddingBottom: spacing.xl + (footer ? 0 : insets.bottom),
      }}
      keyboardShouldPersistTaps="handled"
    >
      <View style={column}>{header ?? defaultHeader}</View>
      {content}
    </ScrollView>
  ) : (
    <View
      style={{
        flex: 1,
        paddingHorizontal: gutter,
        paddingBottom: footer ? 0 : insets.bottom + spacing.lg,
      }}
    >
      <View style={column}>{header ?? defaultHeader}</View>
      {content}
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
      <RadialLift />
      {body}
      {footer ? (
        <View
          style={{
            paddingHorizontal: gutter,
            paddingTop: spacing.md,
            paddingBottom: spacing.md + insets.bottom,
            borderTopWidth: StyleSheet.hairlineWidth * 2,
            borderTopColor: colors.hairline,
            backgroundColor: colors.bg,
            flexShrink: 0,
          }}
        >
          <View style={[column, { gap: spacing.md }]}>{footer}</View>
        </View>
      ) : null}
    </View>
  );
}
