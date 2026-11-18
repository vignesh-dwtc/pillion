import { useEffect, useState } from 'react';
import { Animated, View, useWindowDimensions } from 'react-native';
import { useAnimatedValue } from '../components/motion/useAnimatedValue';

import { useAudioRoute, useDiagnosticsInput, useRideClock, useSessionSnapshot } from '../../app/hooks';
import { useAppNavigation, useGoHome } from '../../app/navigationHooks';
import { SCREEN_TEST_IDS } from '../../app/routes';
import { strings } from '../../app/strings';
import { colors, gutter, spacing, toneColor } from '../../app/theme';
import { AppText, Legend } from '../components/AppText';
import { Banner } from '../components/Card';
import { RideGauge } from '../components/Dial/Gauge';
import { HoldPlate } from '../components/HoldPlate';
import { haptic } from '../components/motion/haptics';
import { BREATH_MS, duration } from '../components/motion/tokens';
import { useAppActive } from '../components/motion/useAppActive';
import { useReducedMotion } from '../components/motion/useReducedMotion';
import { Plate } from '../components/Plate';
import { RingButton } from '../components/RingButton';
import { Screen } from '../components/Screen';
import { TellTale } from '../components/TellTale';

import { describeSession, linkQuality, qualityWord } from './sessionStatus';

/** "1:02:05" / "2:05" for the gauge. */
function clockText(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const ss = String(s).padStart(2, '0');
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`;
}

/** The "on the road" lamp: a dot that breathes (opacity 0.85 to 1 over 4 s) only while linked and in the foreground. */
function Lamp({ color, breathe }: { color: string; breathe: boolean }) {
  const opacity = useAnimatedValue(1);
  useEffect(() => {
    if (!breathe) {
      opacity.setValue(1);
      return;
    }
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(opacity, { toValue: 0.85, duration: BREATH_MS / 2, useNativeDriver: true }),
        Animated.timing(opacity, { toValue: 1, duration: BREATH_MS / 2, useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [breathe, opacity]);
  return (
    <Animated.View
      style={{
        width: 10,
        height: 10,
        borderRadius: 5,
        backgroundColor: color,
        opacity,
        shadowColor: color,
        shadowOpacity: 0.8,
        shadowRadius: 6,
      }}
    />
  );
}

/**
 * Ride: the gauge (link quality, ride time, delay, partner battery), the tell-tales and two glove-sized plates (Mute,
 * hold-to-End). All state comes from the session snapshot; the UI never makes its own transitions. M0 reads a sample
 * session (debug screen: ride preview) and keeps Mute in local state; M1 swaps in the SessionController.
 */
export function RideScreen() {
  const snapshot = useSessionSnapshot();
  const audio = useAudioRoute();
  const diagnostics = useDiagnosticsInput();
  const navigation = useAppNavigation();
  const goHome = useGoHome();
  const { width } = useWindowDimensions();
  const reduced = useReducedMotion();
  const active = useAppActive();
  // PLACEHOLDER: in M1 this is snapshot.muted, changed through SessionController.setMuted.
  const [muted, setMuted] = useState(snapshot.muted);
  const muteFade = useAnimatedValue(1);

  const status = describeSession(snapshot.state);
  const linked = snapshot.state === 'connected';
  const now = useRideClock(active && snapshot.connectedAt !== null);
  const headset = snapshot.local.headsetConnected;
  const partner = snapshot.peer;
  const partnerName = partner?.name ?? strings.home.partnerFallback;
  const sample = diagnostics.sample ?? null;
  const quality = linkQuality(snapshot.state, sample);
  const rtt = linked ? (sample?.rttMs ?? null) : null;
  const delay = rtt === null ? strings.common.notAvailable : String(Math.round(rtt));
  const rideMs = snapshot.connectedAt === null ? 0 : now - snapshot.connectedAt;
  const activeDevice = audio.devices.find((d) => d.id === audio.activeDeviceId)?.name ?? null;
  const gaugeSize = Math.min(Math.min(width, 560) - 2 * gutter, 340);
  const tone = toneColor[status.tone];

  const toggleMute = () => {
    haptic.light();
    setMuted((value) => !value);
    muteFade.setValue(reduced ? 0.6 : 0.35);
    Animated.timing(muteFade, {
      toValue: 1,
      duration: reduced ? duration.reducedCrossfade : duration.mute,
      useNativeDriver: true,
    }).start();
  };

  const summary = strings.ride.gaugeSummary(
    qualityWord(snapshot.state, quality),
    delay,
    partnerName,
    partner?.batteryPct === null || partner?.batteryPct === undefined
      ? strings.common.notAvailable
      : `${partner.batteryPct} percent`,
  );

  const header = (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        paddingTop: spacing.sm,
        paddingBottom: spacing.sm,
      }}
    >
      <View
        testID="status-session"
        role="status"
        aria-live="polite"
        style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm, flexShrink: 1 }}
      >
        <Lamp color={tone} breathe={linked && active && !reduced} />
        <View>
          <Legend color={colors.textSubtle} style={{ fontSize: 11, letterSpacing: 2.2 }}>
            {strings.ride.onTheRoad}
          </Legend>
          <AppText variant="bodyLarge" color={tone} testID="text-session-state">
            {status.label}
          </AppText>
        </View>
      </View>
      <RingButton
        icon="pulse"
        label={strings.home.diagnostics}
        testID="btn-ride-diagnostics"
        onPress={() => navigation.navigate('Diagnostics')}
      />
    </View>
  );

  const footer = (
    <View style={{ flexDirection: 'row', gap: spacing.md }}>
      <Animated.View style={{ flex: 1, opacity: muteFade }}>
        <Plate
          testID="btn-mute"
          size="ride"
          layout="stack"
          role="switch"
          checked={muted}
          variant={muted ? 'muted' : 'mute'}
          icon={muted ? 'mic-off' : 'mic'}
          label={muted ? strings.ride.muted : strings.ride.mute}
          sub={muted ? strings.ride.mutedSub(partnerName) : strings.ride.muteSub}
          accessibilityLabel={strings.ride.muteLabel}
          onPress={toggleMute}
        />
      </Animated.View>
      <View style={{ flex: 1 }}>
        <HoldPlate
          testID="btn-end"
          size="ride"
          layout="stack"
          variant="oxblood"
          icon="stop"
          label={strings.ride.end}
          sub={strings.ride.endSub}
          accessibilityLabel={strings.ride.endLabel}
          onComplete={goHome}
        />
      </View>
    </View>
  );

  return (
    <Screen testID={SCREEN_TEST_IDS.Ride} header={header} footer={footer}>
      <View testID="card-ride-status" style={{ gap: spacing.md }}>
        <RideGauge
          testID="ride-gauge"
          size={gaugeSize}
          state={status.gauge}
          quality={quality}
          rideTime={clockText(rideMs)}
          delay={delay}
          partnerBattery={partner?.batteryPct ?? null}
          accessibilityLabel={summary}
        />
        <View style={{ alignItems: 'center', gap: 2 }}>
          {partner ? (
            <AppText variant="partnerScript" color={colors.brassLight} align="center">
              {strings.ride.withPartner(partner.name)}
            </AppText>
          ) : null}
          <AppText variant="caption" color={colors.textSubtle} align="center">
            {strings.ride.caption}
          </AppText>
        </View>
      </View>

      <View
        style={{
          flexDirection: 'row',
          flexWrap: 'wrap',
          borderTopWidth: 1,
          borderLeftWidth: 1,
          borderColor: colors.hairline,
        }}
      >
        {[
          <TellTale
            key="earbuds"
            testID="status-headset"
            legend={strings.ride.tellEarbuds}
            icon="headset"
            tone={headset ? 'success' : 'warning'}
            value={headset ? (activeDevice ?? strings.ride.earbudsOn) : strings.ride.earbudsOff}
            lightDelay={0}
            align="start"
            minHeight={60}
          />,
          <TellTale
            key="partner-mic"
            testID="status-partner-mic"
            legend={strings.ride.tellPartnerMic(partnerName)}
            icon={partner?.muted ? 'mic-off' : 'mic'}
            tone={partner?.muted ? 'warning' : 'success'}
            value={partner?.muted ? strings.ride.micMuted : strings.ride.micLive}
            lightDelay={60}
            align="start"
            minHeight={60}
          />,
          <TellTale
            key="link"
            legend={strings.ride.tellLink}
            icon="wifi-direct"
            tone={linked ? 'success' : snapshot.state === 'reconnecting' ? 'warning' : 'neutral'}
            value={
              linked
                ? strings.ride.linkUp
                : snapshot.state === 'reconnecting'
                  ? strings.ride.linkRetrying
                  : strings.ride.linkSearching
            }
            lightDelay={120}
            align="start"
            minHeight={60}
          />,
          <TellTale
            key="battery"
            legend={strings.ride.tellBattery}
            icon="battery"
            tone={(snapshot.local.batteryPct ?? 100) <= 20 ? 'warning' : 'success'}
            value={
              snapshot.local.batteryPct === null
                ? strings.common.notAvailable
                : `${snapshot.local.batteryPct} %`
            }
            lightDelay={180}
            align="start"
            minHeight={60}
          />,
        ].map((cell) => (
          <View
            key={cell.key}
            style={{
              width: '50%',
              paddingHorizontal: spacing.md,
              paddingVertical: spacing.xs,
              borderRightWidth: 1,
              borderBottomWidth: 1,
              borderColor: colors.hairline,
            }}
          >
            {cell}
          </View>
        ))}
      </View>

      <Banner testID="banner-placeholder">{strings.placeholder.ride}</Banner>
    </Screen>
  );
}
