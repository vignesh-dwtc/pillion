import { View } from 'react-native';

import { SCREEN_TEST_IDS } from '../../app/routes';
import { planRidePermissions } from '../../app/ridePermissions';
import { strings } from '../../app/strings';
import { colors, spacing } from '../../app/theme';
import type { PermissionStatus } from '../../platform/permissions/PermissionService';
import { AppText } from '../components/AppText';
import { Button } from '../components/Button';
import { StatusPill } from '../components/Card';
import { Icon } from '../components/Icon';
import { Plate } from '../components/Plate';
import { Rule } from '../components/Rule';
import { Screen } from '../components/Screen';
import { PERMISSION_ICONS, describePermissionState } from '../onboarding/permissionView';

/**
 * Shown by Home when Begin ride needs a permission that is not granted yet: each one is explained in plain words
 * BEFORE the system dialog appears (microphone, notifications, Bluetooth). "Allow and begin" lets Android ask and then
 * starts the ride from that same tap; a required permission that is blocked sends the rider to the system settings.
 */
export function PermissionPrimer({
  status,
  allowNoHeadset,
  onAllow,
  onOpenSettings,
  onCancel,
}: {
  status: PermissionStatus;
  allowNoHeadset: boolean;
  onAllow: () => void;
  onOpenSettings: () => void;
  onCancel: () => void;
}) {
  const plan = planRidePermissions(status, allowNoHeadset);
  const copy = strings.home.primer;
  const names = (keys: readonly (keyof typeof copy.names)[]) => keys.map((k) => copy.names[k]).join(' and ');
  const deniedRequired = plan.explain.filter(
    (key) => plan.required.includes(key) && status[key] === 'denied',
  );
  const onlyBlocked = plan.askable.length === 0 && plan.blocked.length > 0;

  return (
    <Screen
      testID={SCREEN_TEST_IDS.Home}
      eyebrow={copy.eyebrow}
      title={copy.title(plan.explain.length)}
      onBack={onCancel}
    >
      <View testID="permission-primer" style={{ gap: spacing.md }}>
        <AppText variant="body" color={colors.textMuted}>
          {copy.body}
        </AppText>
        <View>
          {plan.explain.map((key) => {
            const view = describePermissionState(status[key]);
            return (
              <View key={key} testID={`primer-${key}`}>
                <Rule />
                <View
                  style={{
                    flexDirection: 'row',
                    gap: spacing.md,
                    alignItems: 'flex-start',
                    minHeight: 56,
                    paddingVertical: spacing.md,
                  }}
                >
                  <Icon name={PERMISSION_ICONS[key]} size={22} />
                  <View style={{ flex: 1, gap: spacing.sm }}>
                    <AppText variant="bodyLarge">{copy.why[key]}</AppText>
                    <StatusPill tone={view.tone} icon={view.icon} label={view.label} />
                  </View>
                </View>
              </View>
            );
          })}
          <Rule />
        </View>
        {plan.blocked.length > 0 ? (
          <StatusPill tone="danger" label={copy.blocked(names(plan.blocked))} testID="primer-blocked" />
        ) : deniedRequired.length > 0 ? (
          <StatusPill
            tone="warning"
            label={copy.stillMissing(names(deniedRequired))}
            testID="primer-missing"
          />
        ) : null}
      </View>
      {onlyBlocked ? (
        <Plate
          testID="btn-primer-settings"
          label={copy.openSettings}
          sub={copy.openSettingsSub}
          icon="gear"
          chevron
          onPress={onOpenSettings}
        />
      ) : (
        <Plate
          testID="btn-primer-allow"
          label={copy.allow}
          sub={copy.allowSub}
          icon="shield-check"
          chevron
          onPress={onAllow}
        />
      )}
      {!onlyBlocked && plan.blocked.length > 0 ? (
        <Button
          testID="btn-primer-settings"
          label={copy.openSettings}
          variant="secondary"
          icon="gear"
          onPress={onOpenSettings}
        />
      ) : null}
      <Button testID="btn-primer-cancel" label={copy.notNow} variant="ghost" onPress={onCancel} />
    </Screen>
  );
}
