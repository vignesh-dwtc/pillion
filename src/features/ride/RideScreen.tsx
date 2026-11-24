import { useEffect } from 'react';
import { Animated, View, useWindowDimensions } from 'react-native';
import { useAnimatedValue } from '../components/motion/useAnimatedValue';

import { rideRuntime } from '../../app/composition';
import {
  useAppStore,
  useAudioRoute,
  useRideClock,
  useRideLinkKind,
  useRideSample,
  useRideStartedAt,
  useRideStartProblem,
  useSessionSnapshot,
} from '../../app/hooks';
import { useAppNavigation, useGoHome } from '../../app/navigationHooks';
import { SCREEN_TEST_IDS } from '../../app/routes';
import { strings } from '../../app/strings';
import { colors, gutter, spacing, toneColor } from '../../app/theme';
import { AppText, Legend } from '../components/AppText';
import { RideGauge } from '../components/Dial/Gauge';
import { HoldPlate } from '../components/HoldPlate';
import { haptic } from '../components/motion/haptics';
import { BREATH_MS, duration } from '../components/motion/tokens';
import { useAppActive } from '../components/motion/useAppActive';
import { useReducedMotion } from '../components/motion/useReducedMotion';
import { Plate } from '../components/Plate';
import { RingButton } from '../components/RingButton';
import { Screen } from '../components/Screen';
import { Banner } from '../components/Card';
import { TellTale } from '../components/TellTale';
import { primaryPairing } from '../home/dialModel';

import { describeSession, linkQuality, linkTellTale, qualityWord, rideCaption } from './sessionStatus';

/** Tell-tale cell height: the spec's 60 dp plus room for a two-line value. */
const CELL_HEIGHT = 64;

function chunk<T>(items: T[], size: number): T[][] {
  const rows: T[][] = [];
  for (let i = 0; i < items.length; i += size) rows.push(items.slice(i, i + size));
  return rows;
}

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
 * hold-to-End). Everything comes from the live session snapshot; Mute and End go to the SessionController through the
 * ride runtime, and the UI never makes a transition of its own. The notification's Mute and End buttons reach the
 * same controller, so this screen simply follows the snapshot. Once the ride has ended the plates give way to one
 * Back home plate and, when the ride stopped on its own, the reason.
 */
export function RideScreen() {
  const snapshot = useSessionSnapshot();
  const audio = useAudioRoute();
  const sample = useRideSample();
  const linkKind = useRideLinkKind();
  const startProblem = useRideStartProblem();
  const rideStartedAt = useRideStartedAt();
  const pairings = useAppStore((s) => s.pairings);
  const navigation = useAppNavigation();
  const goHome = useGoHome();
  const { width } = useWindowDimensions();
  const reduced = useReducedMotion();
  const active = useAppActive();
  const muteFade = useAnimatedValue(1);

  const muted = snapshot.muted;
  const live = snapshot.state !== 'idle' && snapshot.state !== 'ended';
  const status = describeSession(snapshot.state);
  const linked = snapshot.state === 'connected';
  const now = useRideClock(active && live && rideStartedAt !== null);
  const headset = snapshot.local.headsetConnected;
  // After the ride the partner's last state is history: the cells show a dash instead of stale values.
  const partner = live ? snapshot.peer : null;
  const stored = primaryPairing(pairings);
  const knownName = snapshot.peer?.name ?? stored?.partnerName ?? null;
  const partnerName = knownName ?? strings.home.partnerFallback;
  const quality = linkQuality(snapshot.state, sample);
  const rtt = linked ? (sample?.rttMs ?? null) : null;
  const delay = rtt === null ? null : String(Math.round(rtt));
  // Ride time runs from the first connection and keeps going through reconnects (frozen once the ride ended).
  const rideMs = rideStartedAt === null ? 0 : Math.max(0, now - rideStartedAt);
  const activeDevice = audio?.devices.find((d) => d.id === audio.activeDeviceId)?.name ?? null;
  const gaugeSize = Math.min(Math.min(width, 560) - 2 * gutter, 340);
  const tone = toneColor[status.tone];
  const link = linkTellTale(snapshot.state, snapshot.attempt);
  const error = snapshot.error;

  const toggleMute = () => {
    haptic.light();
    rideRuntime.setMuted(!muted);
    muteFade.setValue(reduced ? 0.6 : 0.35);
    Animated.timing(muteFade, {
      toValue: 1,
      duration: reduced ? duration.reducedCrossfade : duration.mute,
      useNativeDriver: true,
    }).start();
  };

  const endRide = () => {
    void rideRuntime.end();
    goHome();
  };

  const summary = strings.ride.gaugeSummary(
    qualityWord(snapshot.state, quality),
    delay,
    partnerName,
    partner?.batteryPct === null || partner?.batteryPct === undefined
      ? strings.common.notAvailable
      : `${partner.batteryPct} percent`,
  );

  /** Why the ride is not running (or is retrying): the controller's own words, or the runtime's start refusal. */
  // While live the caption and the Link tell-tale already say what is happening; details are on Diagnostics.
  const notice: { text: string; tone: 'danger' | 'info' } | null =
    startProblem !== null && !live
      ? { text: strings.ride.startProblems[startProblem], tone: 'danger' }
      : error && snapshot.state === 'ended'
        ? { text: error.message, tone: error.code === 'partner-ended' ? 'info' : 'danger' }
        : snapshot.state === 'idle'
          ? { text: strings.ride.notStarted, tone: 'info' }
          : null;

  const header = (
    <View style={{ paddingTop: spacing.sm, paddingBottom: spacing.sm, gap: spacing.sm }}>
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'space-between',
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
            <AppText variant="bodyLarge" color={tone} testID="ride-state">
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
      {notice ? (
        <View testID="ride-notice" aria-live="polite">
          <Banner tone={notice.tone}>{notice.text}</Banner>
        </View>
      ) : null}
    </View>
  );

  const footer = live ? (
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
          onComplete={endRide}
        />
      </View>
    </View>
  ) : (
    <Plate
      testID="btn-back-home"
      label={strings.ride.backHome}
      sub={strings.ride.backHomeSub}
      icon="back"
      onPress={goHome}
    />
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
          <AppText
            variant="partnerScript"
            color={colors.brassLight}
            align="center"
            testID="ride-partner-name"
          >
            {strings.ride.withPartner(partnerName)}
          </AppText>
          <AppText variant="caption" color={colors.textSubtle} align="center" testID="ride-caption">
            {rideCaption(snapshot.state, quality, partnerName, snapshot.transport ?? linkKind)}
          </AppText>
        </View>
      </View>

      <View testID="ride-telltales">
        {chunk(
          [
            <TellTale
              key="earbuds"
              testID="status-headset"
              legend={strings.ride.tellEarbuds}
              icon="headset"
              tone={headset ? 'success' : 'warning'}
              value={headset ? (activeDevice ?? strings.ride.earbudsOn) : strings.ride.earbudsOff}
              lightDelay={0}
              align="start"
              minHeight={CELL_HEIGHT}
            />,
            <TellTale
              key="link"
              testID="status-link"
              legend={strings.ride.tellLink}
              icon="wifi-direct"
              tone={link.tone}
              value={link.value}
              lightDelay={60}
              align="start"
              minHeight={CELL_HEIGHT}
            />,
            <TellTale
              key="partner"
              testID="status-partner"
              legend={knownName ?? strings.ride.tellPartner}
              icon={partner?.muted ? 'mic-off' : 'mic'}
              tone={
                partner ? (partner.muted || !partner.headsetConnected ? 'warning' : 'success') : 'neutral'
              }
              value={
                partner
                  ? strings.ride.partnerSummary(partner.muted, partner.headsetConnected)
                  : live
                    ? strings.ride.partnerUnknown
                    : strings.ride.partnerOffline
              }
              lightDelay={120}
              align="start"
              minHeight={CELL_HEIGHT}
            />,
            <TellTale
              key="battery"
              testID="status-battery"
              legend={strings.ride.tellBattery}
              icon="battery"
              tone={
                snapshot.local.batteryPct === null
                  ? 'neutral'
                  : snapshot.local.batteryPct <= 20
                    ? 'warning'
                    : 'success'
              }
              value={
                snapshot.local.batteryPct === null
                  ? strings.common.notAvailable
                  : `${snapshot.local.batteryPct} %`
              }
              lightDelay={180}
              align="start"
              minHeight={CELL_HEIGHT}
            />,
          ],
          2,
        ).map((row, i) => (
          <View
            key={i}
            style={{
              flexDirection: 'row',
              borderTopWidth: i === 0 ? 0 : 1,
              borderColor: colors.hairline,
            }}
          >
            {row.map((cell, j) => (
              <View
                key={cell.key}
                style={{
                  flex: 1,
                  minHeight: CELL_HEIGHT,
                  justifyContent: 'center',
                  paddingHorizontal: spacing.sm,
                  paddingVertical: spacing.xs,
                  borderLeftWidth: j === 0 ? 0 : 1,
                  borderColor: colors.hairline,
                }}
              >
                {cell}
              </View>
            ))}
          </View>
        ))}
      </View>
    </Screen>
  );
}
