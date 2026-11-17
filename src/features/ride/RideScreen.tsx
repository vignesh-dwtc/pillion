import { useState } from 'react';
import { View } from 'react-native';

import { useAudioRoute, useSessionSnapshot } from '../../app/hooks';
import { useGoHome } from '../../app/navigationHooks';
import { SCREEN_TEST_IDS } from '../../app/routes';
import { strings } from '../../app/strings';
import { colors, spacing, toneColor } from '../../app/theme';
import { AppText } from '../components/AppText';
import { Button } from '../components/Button';
import { Banner, Card, Divider } from '../components/Card';
import { Icon } from '../components/Icon';
import { Screen } from '../components/Screen';

import { describeSession } from './sessionStatus';

/**
 * Ride: connection state, headset state and two huge controls. M0 reads a static sample session and keeps Mute
 * in local state; the live `SessionController` replaces both in M1. Layout and controls stay.
 */
export function RideScreen() {
  const snapshot = useSessionSnapshot();
  const audio = useAudioRoute();
  const goHome = useGoHome();
  // PLACEHOLDER: in M1 this is snapshot.muted, changed through SessionController.setMuted.
  const [muted, setMuted] = useState(snapshot.muted);

  const status = describeSession(snapshot.state);
  const headset = snapshot.local.headsetConnected;
  const partner = snapshot.peer;
  const activeDevice = audio.devices.find((d) => d.id === audio.activeDeviceId)?.name ?? null;

  return (
    <Screen
      testID={SCREEN_TEST_IDS.Ride}
      title={strings.ride.title}
      footer={
        <>
          <Button
            testID="btn-mute"
            size="ride"
            role="switch"
            checked={muted}
            variant={muted ? 'warning' : 'secondary'}
            icon={muted ? 'mic-off' : 'mic'}
            label={muted ? strings.ride.muted : strings.ride.mute}
            hint={muted ? strings.ride.unmuteHint : strings.ride.muteHint}
            accessibilityLabel={strings.ride.muteLabel}
            onPress={() => setMuted((value) => !value)}
          />
          <Button
            testID="btn-end"
            size="ride"
            variant="danger"
            icon="stop"
            label={strings.ride.end}
            accessibilityLabel={strings.ride.endLabel}
            onPress={goHome}
          />
        </>
      }
    >
      <Banner testID="banner-placeholder">{strings.placeholder.ride}</Banner>

      <Card testID="card-ride-status">
        <View aria-live="polite" role="status" testID="status-session" style={{ gap: spacing.xs }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.md }}>
            <Icon name={status.icon} size={44} color={toneColor[status.tone]} strokeWidth={3} />
            <AppText variant="display" testID="text-session-state" style={{ flex: 1 }}>
              {status.label}
            </AppText>
          </View>
          {partner ? (
            <AppText variant="bodyLarge" color={colors.textMuted}>
              {strings.ride.statusWith(partner.name)}
            </AppText>
          ) : null}
        </View>
        <Divider />
        <View testID="status-headset" style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.md }}>
          <Icon name="headset" size={32} color={headset ? toneColor.success : toneColor.danger} />
          <View style={{ flex: 1 }}>
            <AppText variant="bodyLarge" style={{ fontWeight: '700' }}>
              {headset ? strings.ride.headsetConnected : strings.ride.headsetMissing}
            </AppText>
            {headset && activeDevice ? (
              <AppText variant="label" color={colors.textMuted}>
                {strings.ride.headsetDetail(activeDevice)}
              </AppText>
            ) : null}
          </View>
          <Icon
            name={headset ? 'check' : 'close'}
            size={28}
            color={headset ? toneColor.success : toneColor.danger}
          />
        </View>
        {partner ? (
          <View
            testID="status-partner-mic"
            style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.md }}
          >
            <Icon name={partner.muted ? 'mic-off' : 'mic'} size={32} color={colors.textMuted} />
            <AppText variant="bodyLarge" style={{ flex: 1 }}>
              {partner.muted ? strings.ride.partnerMicMuted : strings.ride.partnerMicOn}
            </AppText>
          </View>
        ) : null}
      </Card>
    </Screen>
  );
}
