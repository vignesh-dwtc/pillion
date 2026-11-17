import IDENTITY from '../../../config/identity.json';
import { useAppStore } from '../../app/hooks';
import { useAppNavigation } from '../../app/navigationHooks';
import { SCREEN_TEST_IDS } from '../../app/routes';
import { strings } from '../../app/strings';
import { colors } from '../../app/theme';
import { AppText } from '../components/AppText';
import { Button } from '../components/Button';
import { Card, SectionHeading, StatusPill } from '../components/Card';
import { ListRow } from '../components/ListRow';
import { Screen } from '../components/Screen';

/** Home: who you are paired with, a big Start, and the way to pair. Start opens the placeholder ride in M0. */
export function HomeScreen() {
  const navigation = useAppNavigation();
  const pairings = useAppStore((s) => s.pairings);
  const pairingsStatus = useAppStore((s) => s.pairingsStatus);
  // Stage 1 holds one partner; the data model is a list.
  const pairing = pairings[0] ?? null;

  return (
    <Screen testID={SCREEN_TEST_IDS.Home} title={IDENTITY.displayName} subtitle={strings.home.tagline}>
      <Card testID="card-partner">
        <SectionHeading>{strings.home.partnerHeading}</SectionHeading>
        {pairing ? (
          <>
            <StatusPill tone="success" label="Paired" testID="status-pairing" />
            <AppText variant="bodyLarge" style={{ fontWeight: '700' }}>
              {strings.home.pairedWith(pairing.partnerName ?? strings.home.partnerFallback)}
            </AppText>
            <AppText variant="label" color={colors.textMuted}>
              {pairing.role === 'host' ? strings.home.roleHost : strings.home.roleGuest}
            </AppText>
          </>
        ) : (
          <>
            <StatusPill tone="warning" label={strings.home.notPaired} testID="status-pairing" />
            <AppText variant="body" color={colors.textMuted}>
              {strings.home.notPairedHint}
            </AppText>
          </>
        )}
        {pairingsStatus === 'error' ? (
          <StatusPill tone="danger" label={strings.home.pairingsError} testID="status-pairings-error" />
        ) : null}
      </Card>

      <Button
        testID="btn-start"
        label={strings.home.start}
        hint={strings.home.startHint}
        icon="play"
        variant="primary"
        size="ride"
        onPress={() => navigation.navigate('Ride')}
      />
      <AppText variant="label" color={colors.textSubtle}>
        {strings.placeholder.startNote}
      </AppText>

      <SectionHeading>{strings.home.pairHeading}</SectionHeading>
      <Button
        testID="btn-pair-host"
        label={strings.home.pairHost}
        hint={strings.home.pairHostHint}
        icon="qr"
        size="lg"
        align="start"
        onPress={() => navigation.navigate('PairHost')}
      />
      <Button
        testID="btn-pair-guest"
        label={strings.home.pairGuest}
        hint={strings.home.pairGuestHint}
        icon="camera"
        size="lg"
        align="start"
        onPress={() => navigation.navigate('PairGuest')}
      />

      <ListRow
        testID="btn-settings"
        icon="sliders"
        title={strings.home.settings}
        onPress={() => navigation.navigate('Settings')}
      />
      <ListRow
        testID="btn-diagnostics"
        icon="pulse"
        title={strings.home.diagnostics}
        onPress={() => navigation.navigate('Diagnostics')}
      />
    </Screen>
  );
}
