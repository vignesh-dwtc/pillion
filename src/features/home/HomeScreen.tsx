import { Animated, View, useWindowDimensions } from 'react-native';
import { useAnimatedValue } from '../components/motion/useAnimatedValue';

import { useAppStore, useAudioRoute, useDiagnosticsInput } from '../../app/hooks';
import { useAppNavigation } from '../../app/navigationHooks';
import { SCREEN_TEST_IDS } from '../../app/routes';
import { strings } from '../../app/strings';
import { colors, gutter, spacing } from '../../app/theme';
import { AppText, Legend } from '../components/AppText';
import { StatusPill } from '../components/Card';
import { HeroDial } from '../components/Dial/HeroDial';
import { Icon } from '../components/Icon';
import { NightRoad } from '../components/illustrations/NightRoad';
import { ListRow } from '../components/ListRow';
import { haptic } from '../components/motion/haptics';
import { ease } from '../components/motion/tokens';
import { useReducedMotion } from '../components/motion/useReducedMotion';
import { Plate } from '../components/Plate';
import { RingButton } from '../components/RingButton';
import { Rule } from '../components/Rule';
import { Screen } from '../components/Screen';
import { TellTale } from '../components/TellTale';
import { VersionLabel } from '../components/VersionLabel';
import { usePermissionStatus } from '../onboarding/usePermissionStatus';

import { dialPair, primaryPairing } from './dialModel';

const KEY_TURN_MS = 220;

/** The Begin plate's knob: a dark disc with the key, which turns 60 degrees when the ride begins. */
function KeyKnob({ turn }: { turn: Animated.Value }) {
  const rotate = turn.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '60deg'] });
  return (
    <View
      style={{
        width: 46,
        height: 46,
        borderRadius: 23,
        backgroundColor: colors.onBrass,
        borderWidth: 1,
        borderColor: colors.brassDeep,
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <Animated.View style={{ transform: [{ rotate }] }}>
        <Icon name="key" size={24} color={colors.brassLight} />
      </Animated.View>
    </View>
  );
}

/** Home: the paired dial, readiness tell-tales and Begin ride; or, before pairing, the night road and "Pair". */
export function HomeScreen() {
  const navigation = useAppNavigation();
  const { width } = useWindowDimensions();
  const reduced = useReducedMotion();
  const pairings = useAppStore((s) => s.pairings);
  const pairingsStatus = useAppStore((s) => s.pairingsStatus);
  const deviceName = useAppStore((s) => s.deviceName);
  const audio = useAudioRoute();
  const diagnostics = useDiagnosticsInput();
  const [permissions] = usePermissionStatus();
  const keyTurn = useAnimatedValue(0);

  // Stage 1 holds one partner; the data model is a list (Home shows the most recent pairing).
  const pairing = primaryPairing(pairings);
  const column = Math.min(width, 560) - 2 * gutter;
  const named = deviceName && deviceName !== strings.settings.defaultDeviceName;
  const loss = diagnostics.sample?.lossPct ?? 0;
  const diagnosticsOk = !diagnostics.session?.error && loss < 5;

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
      <View style={{ gap: 2 }}>
        <AppText variant="wordmark" role="heading" aria-level={1} testID="screen-home-title">
          {strings.appName}
        </AppText>
        <Legend style={{ fontSize: 11, letterSpacing: 2.2 }}>{strings.brand.tagline}</Legend>
      </View>
      <RingButton
        icon="gear"
        label={strings.home.settings}
        testID="btn-settings"
        onPress={() => navigation.navigate('Settings')}
      />
    </View>
  );

  const begin = () => {
    haptic.light();
    if (reduced) {
      navigation.navigate('Ride');
      return;
    }
    Animated.timing(keyTurn, {
      toValue: 1,
      duration: KEY_TURN_MS,
      easing: ease,
      useNativeDriver: true,
    }).start(() => {
      navigation.navigate('Ride');
      keyTurn.setValue(0);
    });
  };

  const micOk = permissions.microphone === 'granted' && permissions.notifications !== 'denied';
  const rows = (includeHost: boolean) => (
    <View>
      {includeHost ? (
        <ListRow
          testID="btn-pair-host"
          icon="qr"
          title={strings.home.pairNew}
          hint={strings.home.pairHostHint}
          onPress={() => navigation.navigate('PairHost')}
        />
      ) : null}
      <ListRow
        testID="btn-pair-guest"
        icon="camera"
        title={strings.home.scanPlate}
        hint={strings.home.pairGuestHint}
        onPress={() => navigation.navigate('PairGuest')}
      />
      <ListRow
        testID="btn-diagnostics"
        icon="pulse"
        title={strings.home.diagnostics}
        value={diagnosticsOk ? strings.common.allClear : strings.diagnostics.checkWarn}
        valueColor={diagnosticsOk ? colors.patina : colors.amber}
        onPress={() => navigation.navigate('Diagnostics')}
        last
      />
    </View>
  );

  const errorPill =
    pairingsStatus === 'error' ? (
      <StatusPill tone="danger" label={strings.home.pairingsError} testID="status-pairings-error" />
    ) : null;

  if (!pairing) {
    const dialSize = Math.min(column * 0.66, 240);
    return (
      <Screen testID={SCREEN_TEST_IDS.Home} header={header}>
        <View style={{ marginHorizontal: -gutter, alignItems: 'center' }}>
          <NightRoad width={Math.min(width, 560)} height={200} />
          <View style={{ marginTop: spacing.sm }}>
            <HeroDial
              testID="card-partner"
              size={dialSize}
              pair={null}
              accessibilityLabel={strings.home.dialUnpairedLabel}
            />
          </View>
        </View>
        <View style={{ gap: spacing.sm, alignItems: 'center' }}>
          <View testID="status-pairing" accessible aria-label={strings.home.notPaired}>
            <Legend color={colors.amber}>{strings.home.notPaired}</Legend>
          </View>
          <AppText variant="title" align="center">
            {strings.home.notPairedTitle}
          </AppText>
          <AppText variant="body" color={colors.textMuted} align="center">
            {strings.home.notPairedBody}
          </AppText>
        </View>
        {errorPill}
        <Plate
          testID="btn-pair-host"
          label={strings.home.pairPlate}
          sub={strings.home.pairPlateSub}
          icon="qr"
          chevron
          onPress={() => {
            haptic.light();
            navigation.navigate('PairHost');
          }}
        />
        {rows(false)}
        <VersionLabel onOpenDebug={() => navigation.navigate('Debug')} />
      </Screen>
    );
  }

  const model = dialPair(pairing, deviceName, strings.home.partnerFallback);

  return (
    <Screen testID={SCREEN_TEST_IDS.Home} header={header}>
      <HeroDial
        testID="card-partner"
        size={Math.min(column, 312)}
        pair={{ riderInitial: model.riderInitial, pillionInitial: model.pillionInitial, since: model.since }}
        accessibilityLabel={strings.home.dialPairedLabel(deviceName, model.partner, model.since)}
      />
      <View
        testID="home-partner"
        accessible
        aria-label={`${strings.home.pairedWithLegend} ${pairing.partnerName ?? strings.home.partnerFallback}. ${
          pairing.role === 'host' ? strings.home.roleHost : strings.home.roleGuest
        }. ${strings.home.dialSince(model.since)}.`}
        style={{ alignItems: 'center', gap: 2 }}
      >
        <Legend>{strings.home.pairedWithLegend}</Legend>
        <AppText variant="partnerScriptRow" color={colors.brassLight} testID="home-partner-name">
          {pairing.partnerName ?? strings.home.partnerFallback}
        </AppText>
        <AppText variant="caption" color={colors.textSubtle} align="center" testID="home-partner-detail">
          {`${pairing.role === 'host' ? strings.home.roleHost : strings.home.roleGuest} · ${strings.home.dialSince(model.since)}`}
        </AppText>
        {pairing.partnerName === null ? (
          <AppText variant="caption" color={colors.textSubtle} align="center">
            {strings.home.partnerNameLater}
          </AppText>
        ) : null}
      </View>
      <View style={{ gap: spacing.xs }}>
        <AppText variant="title">{named ? strings.home.ready(deviceName) : strings.home.readyPlain}</AppText>
        <AppText variant="body" color={colors.textMuted}>
          {strings.home.readyBody}
        </AppText>
      </View>
      <View>
        <Rule />
        <View style={{ flexDirection: 'row', paddingVertical: spacing.md }}>
          <View style={{ flex: 1 }}>
            <TellTale
              legend={strings.home.tellEarbuds}
              icon="headset"
              tone={audio.headsetConnected ? 'success' : 'warning'}
              value={audio.headsetConnected ? strings.home.earbudsReady : strings.home.earbudsMissing}
            />
          </View>
          <View style={{ width: 1, backgroundColor: colors.hairline }} />
          <View style={{ flex: 1 }}>
            <TellTale
              testID="status-pairing"
              legend={strings.home.tellPartner}
              icon="link"
              tone="success"
              value={strings.home.partnerPaired}
            />
          </View>
          <View style={{ width: 1, backgroundColor: colors.hairline }} />
          <View style={{ flex: 1 }}>
            <TellTale
              legend={strings.home.tellMic}
              icon="mic"
              tone={micOk ? 'success' : 'warning'}
              value={micOk ? strings.home.micReady : strings.home.micNeeded}
            />
          </View>
        </View>
        <Rule />
      </View>
      {errorPill}
      <Plate
        testID="btn-start"
        label={strings.home.begin}
        sub={strings.home.beginSub(model.partner)}
        leading={<KeyKnob turn={keyTurn} />}
        chevron
        onPress={begin}
      />
      {rows(true)}
      <VersionLabel onOpenDebug={() => navigation.navigate('Debug')} />
    </Screen>
  );
}
