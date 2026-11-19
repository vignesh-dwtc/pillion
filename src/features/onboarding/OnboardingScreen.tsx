import { useState } from 'react';
import { View, useWindowDimensions } from 'react-native';

import { permissionService } from '../../app/composition';
import { useAppStore } from '../../app/hooks';
import { useAppNavigation, useGoHome } from '../../app/navigationHooks';
import { SCREEN_TEST_IDS } from '../../app/routes';
import { strings } from '../../app/strings';
import { colors, gutter, spacing } from '../../app/theme';
import type { PermissionKey } from '../../platform/permissions/PermissionService';
import { AppText, Legend } from '../components/AppText';
import { Button } from '../components/Button';
import { StatusPill } from '../components/Card';
import { Icon } from '../components/Icon';
import { NightRoad } from '../components/illustrations/NightRoad';
import { Vignette, type VignetteKind } from '../components/illustrations/Vignette';
import { haptic } from '../components/motion/haptics';
import { Plate } from '../components/Plate';
import { Rule } from '../components/Rule';
import { Screen } from '../components/Screen';

import { PERMISSION_ICONS, describePermissionState } from './permissionView';
import { usePermissionStatus } from './usePermissionStatus';

const NUMERALS = ['I', 'II', 'III', 'IV'] as const;

interface PlateDef {
  id: 'intro' | 'microphone' | 'nearbyDevices' | 'notifications';
  vignette: VignetteKind | null;
  keys: PermissionKey[];
}

const PLATES: PlateDef[] = [
  { id: 'intro', vignette: null, keys: [] },
  { id: 'microphone', vignette: 'microphone', keys: ['microphone', 'bluetooth'] },
  { id: 'nearbyDevices', vignette: 'nearby', keys: ['nearbyDevices'] },
  { id: 'notifications', vignette: 'notifications', keys: ['notifications'] },
];

/**
 * First run, as four engraved plates: I the night road (what the app is), II the microphone and earbuds, III nearby
 * devices, IV notifications. Each permission shows its state as ring + icon + word ("Allowed" with a patina check,
 * "Needed" with an amber triangle), and the 76 dp brass plate asks for it or moves on.
 */
export function OnboardingScreen() {
  const navigation = useAppNavigation();
  const goHome = useGoHome();
  const { width } = useWindowDimensions();
  const completeOnboarding = useAppStore((s) => s.completeOnboarding);
  const [status, setStatus] = usePermissionStatus();
  const [index, setIndex] = useState(0);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  const plate = PLATES[index] ?? PLATES[0]!;
  const last = index === PLATES.length - 1;
  const copy = strings.onboarding.plates[plate.id];
  const pending = plate.keys.filter((key) => describePermissionState(status[key]).action !== null);
  const blocked = pending.filter((key) => describePermissionState(status[key]).action === 'open-settings');
  const askable = pending.filter((key) => !blocked.includes(key));

  const finish = () => {
    completeOnboarding();
    goHome();
  };
  const next = () => {
    setFailed(false);
    if (last) finish();
    else setIndex(index + 1);
  };

  const act = async () => {
    setFailed(false);
    setBusy(true);
    try {
      if (askable.length > 0) setStatus(await permissionService.request(askable));
      else await permissionService.openSettings();
      haptic.light();
    } catch {
      setFailed(true);
    } finally {
      setBusy(false);
    }
  };

  const firstPending = askable[0] ?? blocked[0];
  const primary = firstPending ? (
    <Plate
      key={`${index}-primary`}
      testID={`btn-allow-${firstPending}`}
      label={askable.length > 0 ? strings.onboarding.allowAll : strings.onboarding.openSettings}
      accessibilityLabel={`${askable.length > 0 ? strings.onboarding.allow : strings.onboarding.openSettings}: ${copy.title}`}
      icon={askable.length > 0 ? 'shield-check' : 'gear'}
      chevron
      disabled={busy}
      onPress={() => void act()}
    />
  ) : (
    <Plate
      key={`${index}-primary`}
      testID={last ? 'btn-onboarding-continue' : 'btn-onboarding-next'}
      label={last ? strings.onboarding.begin : strings.common.next}
      icon={last ? 'flag' : undefined}
      chevron
      onPress={() => {
        haptic.light();
        next();
      }}
    />
  );

  const later = firstPending ? (
    <Button
      key={`${index}-later`}
      testID={last ? 'btn-onboarding-continue' : 'btn-onboarding-later'}
      label={strings.common.later}
      variant="ghost"
      onPress={next}
    />
  ) : null;

  const art =
    plate.id === 'intro' ? (
      <View key={`${index}-art`} style={{ marginHorizontal: -gutter }}>
        <NightRoad width={Math.min(width, 560)} height={220} />
      </View>
    ) : plate.vignette ? (
      <Vignette key={`${index}-art`} kind={plate.vignette} />
    ) : null;

  return (
    <Screen
      testID={SCREEN_TEST_IDS.Onboarding}
      onBack={
        index > 0 ? () => setIndex(index - 1) : navigation.canGoBack() ? () => navigation.goBack() : undefined
      }
    >
      {art}
      <View key={`${index}-title`} style={{ gap: spacing.sm, alignItems: 'center' }}>
        <Legend color={colors.brass}>{strings.onboarding.plateOf(NUMERALS[index] ?? 'I')}</Legend>
        <AppText
          variant="display"
          align="center"
          role="heading"
          aria-level={1}
          testID="screen-onboarding-title"
        >
          {copy.title}
        </AppText>
        <AppText variant="body" color={colors.textMuted} align="center">
          {copy.body}
        </AppText>
      </View>

      {plate.id === 'intro' ? (
        <View key={`${index}-steps`} testID="card-steps">
          {strings.onboarding.steps.map((step, i) => (
            <View key={step}>
              <Rule />
              <View
                style={{
                  flexDirection: 'row',
                  gap: spacing.md,
                  alignItems: 'center',
                  minHeight: 56,
                  paddingVertical: spacing.sm,
                }}
              >
                <AppText variant="button" color={colors.brass} style={{ width: 28, textAlign: 'center' }}>
                  {NUMERALS[i] ?? String(i + 1)}
                </AppText>
                <AppText variant="body" style={{ flex: 1 }}>
                  {step}
                </AppText>
              </View>
            </View>
          ))}
          <Rule />
          <View
            testID="notice-safety"
            role="note"
            style={{
              flexDirection: 'row',
              gap: spacing.md,
              alignItems: 'flex-start',
              paddingTop: spacing.md,
            }}
          >
            <Icon name="warning-triangle" size={18} color={colors.amber} />
            <AppText variant="caption" color={colors.textMuted} style={{ flex: 1 }}>
              {strings.onboarding.safety}
            </AppText>
          </View>
        </View>
      ) : (
        <View key={`${index}-perms`}>
          {plate.keys.map((key) => {
            const view = describePermissionState(status[key]);
            const perm = strings.onboarding.permissions[key];
            return (
              <View key={key} testID={`permission-${key}`}>
                <Rule />
                <View
                  style={{
                    flexDirection: 'row',
                    gap: spacing.md,
                    alignItems: 'center',
                    minHeight: 56,
                    paddingVertical: spacing.md,
                  }}
                >
                  <Icon name={PERMISSION_ICONS[key]} size={20} />
                  <View style={{ flex: 1, gap: 2 }}>
                    <AppText variant="bodyLarge">{perm.title}</AppText>
                    <AppText variant="caption" color={colors.textSubtle}>
                      {perm.why}
                    </AppText>
                  </View>
                </View>
                <View style={{ paddingBottom: spacing.md, paddingLeft: 32 }}>
                  <StatusPill
                    tone={view.tone}
                    icon={view.icon}
                    label={view.label}
                    testID={`permission-${key}-status`}
                  />
                </View>
              </View>
            );
          })}
          <Rule />
          {failed ? (
            <View style={{ paddingTop: spacing.md }}>
              <StatusPill tone="danger" label={strings.onboarding.permissionError} />
            </View>
          ) : null}
        </View>
      )}

      {primary}
      {later}
      <AppText key={`${index}-note`} variant="caption" color={colors.textSubtle} align="center">
        {strings.onboarding.permissionsNote}
      </AppText>
    </Screen>
  );
}
