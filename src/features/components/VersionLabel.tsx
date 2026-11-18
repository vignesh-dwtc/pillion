import { useIsFocused } from '@react-navigation/native';
import { useState } from 'react';
import { AccessibilityInfo, Pressable, View } from 'react-native';

import { useAppStore } from '../../app/hooks';
import { strings } from '../../app/strings';
import { createTapCounter } from '../../app/tapCounter';
import { colors, hit, spacing } from '../../app/theme';
import { APP_VERSION } from '../../app/version';

import { AppText } from './AppText';

/**
 * Engraved version label ("OFFLINE · v0.1.0"), padded to a 48 dp target. Seven quick taps switch developer mode on
 * and open the hidden debug screen. Only the focused screen carries the `label-version` test id.
 */
export function VersionLabel({ onOpenDebug }: { onOpenDebug: () => void }) {
  const setDeveloperMode = useAppStore((s) => s.setDeveloperMode);
  const focused = useIsFocused();
  const [counter] = useState(() => createTapCounter());
  const [hint, setHint] = useState<string | null>(null);

  const onPress = () => {
    const result = counter.tap();
    if (result.triggered) {
      setDeveloperMode(true);
      setHint(strings.settings.developerModeEnabled);
      AccessibilityInfo.announceForAccessibility(strings.settings.developerModeEnabled);
      onOpenDebug();
      return;
    }
    // Stay silent for the first taps so the entry stays hidden from ordinary use.
    setHint(result.count >= 3 ? strings.settings.developerTapsRemaining(result.remaining) : null);
  };

  return (
    <View style={{ alignItems: 'center', paddingTop: spacing.sm }}>
      <Pressable
        testID={focused ? 'label-version' : undefined}
        role="button"
        aria-label={strings.settings.versionLabel(APP_VERSION)}
        onPress={onPress}
        style={{
          minHeight: hit.min,
          minWidth: hit.min,
          alignItems: 'center',
          justifyContent: 'center',
          paddingHorizontal: spacing.xl,
        }}
      >
        <AppText variant="legend" color={colors.textSubtle}>
          {strings.brand.versionLabel(APP_VERSION)}
        </AppText>
      </Pressable>
      <AppText
        variant="caption"
        color={colors.textMuted}
        aria-live="polite"
        testID={focused ? 'text-developer-hint' : undefined}
      >
        {hint ?? ' '}
      </AppText>
    </View>
  );
}
