import { useCallback, useEffect, useState } from 'react';
import { View, useWindowDimensions } from 'react-native';

import { pairingService } from '../../app/composition';
import { useAppStore } from '../../app/hooks';
import { useBack, useGoHome } from '../../app/navigationHooks';
import { createScanGate, type GuestPairingError } from '../../app/pairing';
import { SCREEN_TEST_IDS } from '../../app/routes';
import { strings } from '../../app/strings';
import { colors, gutter, spacing } from '../../app/theme';
import { AppText, Legend } from '../components/AppText';
import { Button } from '../components/Button';
import { Banner, SectionHeading } from '../components/Card';
import { HeroDial } from '../components/Dial/HeroDial';
import { haptic } from '../components/motion/haptics';
import { Plate } from '../components/Plate';
import { Screen } from '../components/Screen';
import { TextField } from '../components/TextField';
import { formatSince, initialOf } from '../home/dialModel';

import { CAMERA_SCANNING_AVAILABLE, QrScanner } from './QrScanner';

const MAX_VIEWFINDER = 320;
/** After "Paired with ..." the screen returns to Home on its own (the rider may have gloves on). */
const RETURN_HOME_MS = 4000;

type Source = 'scan' | 'paste';

interface Paired {
  partnerName: string;
  alreadyPaired: boolean;
  at: number;
}

/**
 * Guest pairing: scans the host's pairing plate with the camera (native) or takes a pasted pairing string (developer
 * mode, and always on web where there is no camera). Both paths run the same decode-validate-save in the pairing
 * service. Duplicate camera scans are debounced; a rejected code shows one friendly message and scanning goes on.
 */
export function PairGuestScreen() {
  const back = useBack();
  const goHome = useGoHome();
  const { width } = useWindowDimensions();
  const developerMode = useAppStore((s) => s.developerMode);
  const deviceName = useAppStore((s) => s.deviceName);
  const [pasted, setPasted] = useState('');
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState<{ kind: GuestPairingError; source: Source } | null>(null);
  const [paired, setPaired] = useState<Paired | null>(null);
  const [gate] = useState(() => createScanGate({ now: Date.now }));
  const size = Math.max(220, Math.min(MAX_VIEWFINDER, Math.min(width, 560) - 2 * gutter));
  const showPaste = developerMode || !CAMERA_SCANNING_AVAILABLE;

  useEffect(() => {
    if (!paired) return;
    const timer = setTimeout(goHome, RETURN_HOME_MS);
    return () => clearTimeout(timer);
  }, [paired, goHome]);

  const handle = useCallback(
    async (text: string, source: Source) => {
      setChecking(true);
      const result = await pairingService.acceptPairingString(text);
      setChecking(false);
      if (result.ok) {
        haptic.success();
        setError(null);
        setPasted('');
        setPaired({ partnerName: result.partnerName, alreadyPaired: result.alreadyPaired, at: Date.now() });
        return; // the gate stays closed: this screen is done
      }
      haptic.warning();
      setError({ kind: result.error, source });
      gate.release();
    },
    [gate],
  );

  const onScan = useCallback(
    (data: string) => {
      if (!gate.tryEnter(data)) return;
      void handle(data, 'scan');
    },
    [gate, handle],
  );

  const onPaste = () => {
    if (checking || pasted.trim().length === 0) return;
    void handle(pasted, 'paste');
  };

  if (paired) {
    const dial = Math.min(Math.min(width, 560) - 2 * gutter, 280);
    const since = formatSince(paired.at);
    return (
      <Screen
        testID={SCREEN_TEST_IDS.PairGuest}
        eyebrow={strings.pairGuest.eyebrow}
        title={strings.pairGuest.title}
        onBack={goHome}
      >
        <HeroDial
          testID="dial-paired"
          size={dial}
          pair={{
            riderInitial: initialOf(paired.partnerName),
            pillionInitial: initialOf(deviceName),
            since,
          }}
          accessibilityLabel={strings.home.dialPairedLabel(deviceName, paired.partnerName, since)}
        />
        <View
          testID="status-paired"
          role="status"
          aria-live="polite"
          style={{ alignItems: 'center', gap: spacing.sm }}
        >
          <Legend color={colors.patina}>{strings.pairGuest.successLegend}</Legend>
          <AppText variant="title" align="center">
            {strings.pairGuest.pairedWith(paired.partnerName)}
          </AppText>
          <AppText variant="body" color={colors.textMuted} align="center">
            {paired.alreadyPaired ? strings.pairGuest.alreadyPaired : strings.pairGuest.successBody}
          </AppText>
        </View>
        <Plate
          testID="btn-pair-home"
          label={strings.pairGuest.toHome}
          sub={strings.pairGuest.returning}
          icon="check"
          chevron
          onPress={goHome}
        />
      </Screen>
    );
  }

  const scanError = error?.source === 'scan' ? strings.pairGuest.errors[error.kind] : null;
  const pasteError = error?.source === 'paste' ? strings.pairGuest.errors[error.kind] : null;

  return (
    <Screen
      testID={SCREEN_TEST_IDS.PairGuest}
      eyebrow={strings.pairGuest.eyebrow}
      title={strings.pairGuest.title}
      onBack={back}
    >
      <View style={{ gap: spacing.md }}>
        <QrScanner size={size} active={!checking} onScan={onScan} />
        <View aria-live="polite" style={{ gap: spacing.sm }}>
          {checking ? (
            <AppText testID="status-checking" variant="bodyLarge" align="center">
              {strings.pairGuest.checking}
            </AppText>
          ) : null}
          {scanError ? (
            <Banner testID="notice-scan-error" tone="warning">
              {scanError}
            </Banner>
          ) : null}
        </View>
        {CAMERA_SCANNING_AVAILABLE ? (
          <>
            <AppText variant="body" color={colors.textMuted} align="center">
              {strings.pairGuest.caption}
            </AppText>
            <AppText variant="caption" color={colors.textSubtle} align="center">
              {strings.pairGuest.instruction}
            </AppText>
          </>
        ) : null}
      </View>

      {showPaste ? (
        <View testID="card-paste-pairing" style={{ gap: spacing.md }}>
          <SectionHeading
            icon="wrench"
            color={CAMERA_SCANNING_AVAILABLE ? colors.vermilion : colors.textSubtle}
          >
            {CAMERA_SCANNING_AVAILABLE ? strings.pairGuest.devHeading : strings.pairGuest.webHeading}
          </SectionHeading>
          <TextField
            testID="input-pairing-string"
            label={strings.pairGuest.devLabel}
            hint={strings.pairGuest.devHint}
            placeholder={strings.pairGuest.devPlaceholder}
            value={pasted}
            secure
            onChangeText={(text) => {
              setPasted(text);
              if (error?.source === 'paste') setError(null);
            }}
            onSubmitEditing={onPaste}
          />
          <Button
            testID="btn-pair-paste"
            label={strings.pairGuest.devButton}
            variant="secondary"
            disabled={pasted.trim().length === 0}
            busy={checking}
            onPress={onPaste}
          />
          {pasteError ? (
            <View aria-live="polite">
              <Banner testID="notice-paste">{pasteError}</Banner>
            </View>
          ) : null}
        </View>
      ) : null}

      <Button testID="btn-pair-cancel" label={strings.pairGuest.cancel} variant="ghost" onPress={back} />
    </Screen>
  );
}
