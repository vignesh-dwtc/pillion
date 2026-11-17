import { useEffect, useRef, useState } from 'react';
import { AccessibilityInfo, Pressable, View } from 'react-native';

import { useAppStore } from '../../app/hooks';
import { useAppNavigation, useBack } from '../../app/navigationHooks';
import { DEVICE_NAME_MAX_LENGTH, sanitizeDeviceName } from '../../app/persistence';
import { SCREEN_TEST_IDS } from '../../app/routes';
import { strings } from '../../app/strings';
import { createTapCounter } from '../../app/tapCounter';
import { colors, hit, spacing } from '../../app/theme';
import { APP_VERSION } from '../../app/version';
import { AppText } from '../components/AppText';
import { Button } from '../components/Button';
import { Card, Divider, SectionHeading } from '../components/Card';
import { ListRow } from '../components/ListRow';
import { Screen } from '../components/Screen';
import { TextField } from '../components/TextField';
import { ToggleRow } from '../components/ToggleRow';

/** How long the "tap again to forget" confirmation stays armed. */
const CONFIRM_MS = 4000;

/** Settings: device name, setup shortcuts, paired partners, developer mode and the version label (7 taps = debug). */
export function SettingsScreen() {
  const back = useBack();
  const navigation = useAppNavigation();
  const deviceName = useAppStore((s) => s.deviceName);
  const setDeviceName = useAppStore((s) => s.setDeviceName);
  const developerMode = useAppStore((s) => s.developerMode);
  const setDeveloperMode = useAppStore((s) => s.setDeveloperMode);
  const pairings = useAppStore((s) => s.pairings);
  const removePairing = useAppStore((s) => s.removePairing);

  const [draftName, setDraftName] = useState(deviceName);
  const [armedPairId, setArmedPairId] = useState<string | null>(null);
  const armTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (armTimer.current) clearTimeout(armTimer.current);
    },
    [],
  );

  const onForget = (pairId: string) => {
    if (armedPairId === pairId) {
      if (armTimer.current) clearTimeout(armTimer.current);
      setArmedPairId(null);
      void removePairing(pairId);
      return;
    }
    setArmedPairId(pairId);
    if (armTimer.current) clearTimeout(armTimer.current);
    armTimer.current = setTimeout(() => setArmedPairId(null), CONFIRM_MS);
  };

  return (
    <Screen testID={SCREEN_TEST_IDS.Settings} title={strings.settings.title} onBack={back}>
      <Card>
        <SectionHeading>{strings.settings.deviceHeading}</SectionHeading>
        <TextField
          testID="input-device-name"
          label={strings.settings.deviceNameLabel}
          hint={strings.settings.deviceNameHint}
          placeholder={strings.settings.deviceNamePlaceholder}
          value={draftName}
          maxLength={DEVICE_NAME_MAX_LENGTH}
          autoCapitalize="words"
          onChangeText={(text) => {
            setDraftName(text);
            setDeviceName(text);
          }}
          onBlur={() => setDraftName(sanitizeDeviceName(draftName, strings.settings.defaultDeviceName))}
        />
      </Card>

      <Card>
        <SectionHeading>{strings.settings.setupHeading}</SectionHeading>
        <ListRow
          testID="btn-permissions"
          icon="bell"
          title={strings.settings.permissions}
          hint={strings.settings.permissionsHint}
          onPress={() => navigation.navigate('Onboarding')}
        />
        <ListRow
          testID="btn-settings-diagnostics"
          icon="pulse"
          title={strings.settings.diagnostics}
          hint={strings.settings.diagnosticsHint}
          onPress={() => navigation.navigate('Diagnostics')}
        />
      </Card>

      <Card testID="card-partners">
        <SectionHeading>{strings.settings.partnerHeading}</SectionHeading>
        {pairings.length === 0 ? (
          <AppText variant="body" color={colors.textMuted}>
            {strings.settings.noPartner}
          </AppText>
        ) : (
          pairings.map((pairing, index) => {
            const name = pairing.partnerName ?? strings.home.partnerFallback;
            const armed = armedPairId === pairing.pairId;
            return (
              <View key={pairing.pairId} style={{ gap: spacing.md }}>
                {index > 0 ? <Divider /> : null}
                <AppText variant="bodyLarge" style={{ fontWeight: '700' }}>
                  {name}
                </AppText>
                <AppText variant="label" color={colors.textMuted}>
                  {pairing.role === 'host' ? strings.home.roleHost : strings.home.roleGuest}
                </AppText>
                <Button
                  testID={`btn-forget-${pairing.pairId}`}
                  label={armed ? strings.settings.forgetConfirm : strings.settings.forget}
                  accessibilityLabel={
                    armed ? strings.settings.forgetConfirm : strings.settings.forgetLabel(name)
                  }
                  variant={armed ? 'danger' : 'secondary'}
                  icon="close"
                  onPress={() => onForget(pairing.pairId)}
                />
              </View>
            );
          })
        )}
      </Card>

      <Card>
        <SectionHeading>{strings.settings.advancedHeading}</SectionHeading>
        <ToggleRow
          testID="toggle-developer-mode"
          label={strings.settings.developerMode}
          hint={strings.settings.developerModeHint}
          value={developerMode}
          onValueChange={setDeveloperMode}
        />
      </Card>

      <VersionLabel onOpenDebug={() => navigation.navigate('Debug')} />
    </Screen>
  );
}

/** Version text. Seven quick taps switch developer mode on and open the hidden debug screen. */
function VersionLabel({ onOpenDebug }: { onOpenDebug: () => void }) {
  const setDeveloperMode = useAppStore((s) => s.setDeveloperMode);
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
    <View style={{ alignItems: 'center', paddingTop: spacing.md }}>
      <Pressable
        testID="label-version"
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
        <AppText variant="label" color={colors.textMuted}>
          {strings.settings.versionLabel(APP_VERSION)}
        </AppText>
      </Pressable>
      <AppText variant="label" color={colors.textMuted} aria-live="polite" testID="text-developer-hint">
        {hint ?? ' '}
      </AppText>
    </View>
  );
}
