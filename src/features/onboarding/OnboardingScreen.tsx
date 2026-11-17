import { useEffect, useState } from 'react';
import { AppState, View } from 'react-native';

import { permissionService } from '../../app/composition';
import { useAppStore } from '../../app/hooks';
import { useAppNavigation, useGoHome } from '../../app/navigationHooks';
import { SCREEN_TEST_IDS } from '../../app/routes';
import { strings } from '../../app/strings';
import { colors, spacing } from '../../app/theme';
import type { PermissionKey, PermissionStatus } from '../../platform/permissions/PermissionService';
import { AppText } from '../components/AppText';
import { Button } from '../components/Button';
import { Card, SectionHeading, StatusPill } from '../components/Card';
import { Icon } from '../components/Icon';
import { Screen } from '../components/Screen';

import { PERMISSION_ICONS, PERMISSION_KEYS, describePermissionState } from './permissionView';

const UNKNOWN: PermissionStatus = {
  microphone: 'undetermined',
  notifications: 'undetermined',
  bluetooth: 'undetermined',
  nearbyDevices: 'undetermined',
};

/** First-run explanation of the app and of each permission, with a button to grant it. */
export function OnboardingScreen() {
  const navigation = useAppNavigation();
  const goHome = useGoHome();
  const completeOnboarding = useAppStore((s) => s.completeOnboarding);
  const [status, setStatus] = useState<PermissionStatus>(UNKNOWN);
  const [busy, setBusy] = useState<PermissionKey | null>(null);
  const [failed, setFailed] = useState<PermissionKey | null>(null);

  useEffect(() => {
    let cancelled = false;
    const load = () => {
      permissionService.check().then(
        (next) => {
          if (!cancelled) setStatus(next);
        },
        () => {
          if (!cancelled) setStatus(UNKNOWN);
        },
      );
    };
    load();
    // Coming back from the system settings: look again.
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') load();
    });
    return () => {
      cancelled = true;
      subscription.remove();
    };
  }, []);

  const onAction = async (key: PermissionKey, action: 'allow' | 'open-settings') => {
    setFailed(null);
    setBusy(key);
    try {
      if (action === 'open-settings') {
        await permissionService.openSettings();
      } else {
        setStatus(await permissionService.request([key]));
      }
    } catch {
      setFailed(key);
    } finally {
      setBusy(null);
    }
  };

  return (
    <Screen
      testID={SCREEN_TEST_IDS.Onboarding}
      title={strings.onboarding.title}
      onBack={navigation.canGoBack() ? () => navigation.goBack() : undefined}
      footer={
        <Button
          testID="btn-onboarding-continue"
          label={strings.onboarding.continue}
          variant="primary"
          size="lg"
          onPress={() => {
            completeOnboarding();
            goHome();
          }}
        />
      }
    >
      <AppText variant="bodyLarge">{strings.onboarding.intro}</AppText>

      <Card testID="card-steps">
        {strings.onboarding.steps.map((step, index) => (
          <View key={step} style={{ flexDirection: 'row', gap: spacing.md, alignItems: 'flex-start' }}>
            <View
              style={{
                width: 36,
                height: 36,
                borderRadius: 18,
                backgroundColor: colors.surfaceSelected,
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <AppText variant="label" style={{ fontWeight: '800' }}>
                {String(index + 1)}
              </AppText>
            </View>
            <AppText variant="body" style={{ flex: 1 }}>
              {step}
            </AppText>
          </View>
        ))}
      </Card>

      <View
        testID="notice-safety"
        role="note"
        style={{ flexDirection: 'row', gap: spacing.md, alignItems: 'flex-start' }}
      >
        <Icon name="alert" size={28} color={colors.warning} />
        <AppText variant="body" style={{ flex: 1 }}>
          {strings.onboarding.safety}
        </AppText>
      </View>

      <SectionHeading>{strings.onboarding.permissionsHeading}</SectionHeading>
      {PERMISSION_KEYS.map((key) => {
        const view = describePermissionState(status[key]);
        const copy = strings.onboarding.permissions[key];
        return (
          <Card key={key} testID={`permission-${key}`}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.md }}>
              <Icon name={PERMISSION_ICONS[key]} size={32} />
              <AppText variant="heading" style={{ flex: 1 }}>
                {copy.title}
              </AppText>
            </View>
            <AppText variant="body" color={colors.textMuted}>
              {copy.why}
            </AppText>
            <StatusPill
              tone={view.tone}
              icon={view.icon}
              label={view.label}
              testID={`permission-${key}-status`}
            />
            {failed === key ? <StatusPill tone="danger" label={strings.onboarding.permissionError} /> : null}
            {view.action ? (
              <Button
                testID={`btn-allow-${key}`}
                label={view.action === 'allow' ? strings.onboarding.allow : strings.onboarding.openSettings}
                accessibilityLabel={`${view.action === 'allow' ? strings.onboarding.allow : strings.onboarding.openSettings}: ${copy.title}`}
                variant="secondary"
                busy={busy === key}
                onPress={() => void onAction(key, view.action as 'allow' | 'open-settings')}
              />
            ) : null}
          </Card>
        );
      })}
      <AppText variant="label" color={colors.textMuted}>
        {strings.onboarding.permissionsNote}
      </AppText>
    </Screen>
  );
}
