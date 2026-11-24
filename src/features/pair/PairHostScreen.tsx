import * as Clipboard from 'expo-clipboard';
import { useCallback, useEffect, useState } from 'react';
import { View, useWindowDimensions } from 'react-native';

import { pairingService } from '../../app/composition';
import { useAppStore } from '../../app/hooks';
import { useAppNavigation, useBack, useGoHome } from '../../app/navigationHooks';
import { pairingHostName, type HostOffer } from '../../app/pairing';
import { SCREEN_TEST_IDS } from '../../app/routes';
import { strings } from '../../app/strings';
import { colors, gutter, spacing } from '../../app/theme';
import { AppText } from '../components/AppText';
import { Button } from '../components/Button';
import { Banner, SectionHeading } from '../components/Card';
import { Icon, type IconName } from '../components/Icon';
import { ListRow } from '../components/ListRow';
import { haptic } from '../components/motion/haptics';
import { PairingPlate } from '../components/PairingPlate';
import { Rule } from '../components/Rule';
import { Screen } from '../components/Screen';
import { Stopwatch } from '../components/Stopwatch';

import { RomanStepper } from './RomanStepper';

const HOW_TO_ICONS: IconName[] = ['phone', 'camera', 'bell'];

type OfferStatus = 'loading' | 'ready' | 'error';

/**
 * Host pairing: shows this phone's pairing offer as a QR on the pairing plate. Opening the screen reuses the unused
 * offer (or generates and saves one); "New code" replaces it. The pairing string (it carries the secret) lives only in
 * this component's state and in the QR; it is never shown as text. Developer mode adds "Copy pairing string" for the
 * paste field on the other phone.
 */
export function PairHostScreen() {
  const navigation = useAppNavigation();
  const goHome = useGoHome();
  const back = useBack();
  const { width } = useWindowDimensions();
  const deviceName = useAppStore((s) => s.deviceName);
  const developerMode = useAppStore((s) => s.developerMode);
  const hostName = pairingHostName(deviceName, strings.settings.defaultDeviceName);
  const plateWidth = Math.min(width, 560) - 2 * gutter;

  const [offer, setOffer] = useState<HostOffer | null>(null);
  const [status, setStatus] = useState<OfferStatus>('loading');
  const [attempt, setAttempt] = useState(0);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [copyNotice, setCopyNotice] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    pairingService.hostOffer(hostName).then(
      (next) => {
        if (!alive) return;
        setOffer(next);
        setStatus('ready');
      },
      () => {
        // The error is not logged: it may come from a layer that handled the secret.
        if (alive) setStatus('error');
      },
    );
    return () => {
      alive = false;
    };
  }, [hostName, attempt]);

  const newCode = useCallback(() => {
    setBusy(true);
    setCopyNotice(null);
    pairingService
      .regenerateOffer(hostName)
      .then(
        (next) => {
          haptic.light();
          setOffer(next);
          setStatus('ready');
          setNotice(strings.pairHost.newCodeDone);
        },
        () => setStatus('error'),
      )
      .finally(() => setBusy(false));
  }, [hostName]);

  const copy = useCallback(() => {
    if (!offer) return;
    Clipboard.setStringAsync(offer.pairingString, { android: { isSensitive: true } }).then(
      (ok) => setCopyNotice(ok ? strings.pairHost.devCopied : strings.pairHost.devCopyFailed),
      () => setCopyNotice(strings.pairHost.devCopyFailed),
    );
  }, [offer]);

  return (
    <Screen
      testID={SCREEN_TEST_IDS.PairHost}
      eyebrow={strings.pairHost.eyebrow}
      title={strings.pairHost.title}
      onBack={back}
    >
      <RomanStepper steps={strings.pairHost.steps} active={0} />

      {status === 'error' ? (
        <View style={{ gap: spacing.md }}>
          <Banner testID="notice-offer-error" tone="danger">
            {strings.pairHost.offerError}
          </Banner>
          <Button
            testID="btn-offer-retry"
            label={strings.pairHost.retry}
            icon="reset"
            onPress={() => {
              setStatus('loading');
              setAttempt((n) => n + 1);
            }}
          />
        </View>
      ) : offer ? (
        <PairingPlate
          testID="qr-code"
          value={offer.pairingString}
          hostName={offer.hostName}
          width={plateWidth}
          accessibilityLabel={strings.pairHost.qrLabel(offer.hostName)}
        />
      ) : (
        <View
          testID="status-offer-loading"
          style={{ minHeight: 280, alignItems: 'center', justifyContent: 'center', gap: spacing.md }}
        >
          <Stopwatch />
          <AppText variant="body" color={colors.textMuted}>
            {strings.pairHost.preparing}
          </AppText>
        </View>
      )}

      <View
        role="status"
        aria-live="polite"
        testID="status-waiting"
        style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.md }}
      >
        <Stopwatch />
        <View style={{ flex: 1, gap: 2 }}>
          <AppText variant="bodyLarge">{strings.pairHost.waiting}</AppText>
          <AppText variant="caption" color={colors.textSubtle}>
            {strings.pairHost.waitingHint}
          </AppText>
        </View>
      </View>

      <View>
        <ListRow
          testID="btn-host-name"
          icon="phone"
          title={strings.pairHost.nameRow}
          value={hostName}
          hint={strings.pairHost.nameRowHint}
          onPress={() => navigation.navigate('Settings')}
          last
        />
      </View>

      <Button
        testID="btn-pair-cancel"
        label={strings.pairHost.done}
        hint={strings.pairHost.doneHint}
        variant="primary"
        icon="check"
        onPress={goHome}
      />
      <Button
        testID="btn-new-code"
        label={strings.pairHost.newCode}
        hint={strings.pairHost.newCodeHint}
        icon="reset"
        busy={busy || status === 'loading'}
        onPress={newCode}
      />
      {notice ? (
        <View aria-live="polite">
          <Banner testID="notice-new-code" tone="info">
            {notice}
          </Banner>
        </View>
      ) : null}

      <AppText variant="caption" color={colors.textSubtle}>
        {strings.pairHost.privacy}
      </AppText>

      <View>
        <SectionHeading>{strings.pairHost.howToHeading}</SectionHeading>
        <View style={{ marginTop: spacing.sm }}>
          {strings.pairHost.howTo.map((line, index) => (
            <View key={line}>
              <Rule />
              <View
                style={{
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: spacing.md,
                  minHeight: 56,
                  paddingVertical: spacing.sm,
                }}
              >
                <Icon name={HOW_TO_ICONS[index] ?? 'info'} size={20} />
                <AppText variant="body" style={{ flex: 1 }}>
                  {line}
                </AppText>
              </View>
            </View>
          ))}
          <Rule />
        </View>
      </View>

      {developerMode && offer ? (
        <View testID="card-dev-pairing-string" style={{ gap: spacing.md }}>
          <SectionHeading icon="wrench" color={colors.vermilion}>
            {strings.pairHost.devHeading}
          </SectionHeading>
          <AppText variant="caption" color={colors.textMuted}>
            {strings.pairHost.devNote}
          </AppText>
          <Button testID="btn-copy-pairing" label={strings.pairHost.devCopy} icon="share" onPress={copy} />
          {copyNotice ? (
            <View aria-live="polite">
              <Banner testID="notice-copy" tone="info">
                {copyNotice}
              </Banner>
            </View>
          ) : null}
        </View>
      ) : null}
    </Screen>
  );
}
