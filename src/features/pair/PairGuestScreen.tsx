import { useState } from 'react';
import { View, useWindowDimensions } from 'react-native';

import { useAppStore } from '../../app/hooks';
import { useBack } from '../../app/navigationHooks';
import { SCREEN_TEST_IDS } from '../../app/routes';
import { strings } from '../../app/strings';
import { colors, gutter, spacing } from '../../app/theme';
import { AppText } from '../components/AppText';
import { Button } from '../components/Button';
import { Banner, SectionHeading } from '../components/Card';
import { Icon } from '../components/Icon';
import { Plate } from '../components/Plate';
import { Screen } from '../components/Screen';
import { TextField } from '../components/TextField';
import { permissionService } from '../../app/composition';
import { cameraPreviewDenied } from '../../app/preview';

import { Viewfinder } from './Viewfinder';

const MAX_VIEWFINDER = 320;

/**
 * Guest pairing: scans the host's pairing plate. M0 shows the viewfinder placeholder; the "paste pairing string" path
 * exists only in developer mode (DECISIONS D-022) and does not save anything yet. The camera-denied state is wired
 * to the camera permission with the scanner in M1.
 */
export function PairGuestScreen() {
  // PLACEHOLDER: M1 reads the camera permission with the scanner.
  const cameraDenied = cameraPreviewDenied;
  const back = useBack();
  const { width } = useWindowDimensions();
  const developerMode = useAppStore((s) => s.developerMode);
  const [pasted, setPasted] = useState('');
  const [notice, setNotice] = useState<string | null>(null);
  const size = Math.max(220, Math.min(MAX_VIEWFINDER, Math.min(width, 560) - 2 * gutter));

  return (
    <Screen
      testID={SCREEN_TEST_IDS.PairGuest}
      eyebrow={strings.pairGuest.eyebrow}
      title={strings.pairGuest.title}
      onBack={back}
    >
      {cameraDenied ? (
        <View
          testID="camera-denied"
          style={{ alignItems: 'center', gap: spacing.md, paddingVertical: spacing.xl }}
        >
          <Icon name="camera" size={40} color={colors.amber} />
          <AppText variant="body" align="center">
            {strings.pairGuest.cameraDenied}
          </AppText>
          <Plate
            testID="btn-camera-settings"
            label={strings.pairGuest.openSettings}
            icon="gear"
            style={{ alignSelf: 'stretch' }}
            onPress={() => void permissionService.openSettings()}
          />
        </View>
      ) : (
        <View style={{ gap: spacing.md }}>
          <Viewfinder
            testID="viewfinder"
            size={size}
            title={strings.pairGuest.viewfinder}
            note={strings.pairGuest.viewfinderNote}
            accessibilityLabel={strings.pairGuest.viewfinderLabel}
          />
          <AppText variant="body" color={colors.textMuted} align="center">
            {strings.pairGuest.caption}
          </AppText>
          <AppText variant="caption" color={colors.textSubtle} align="center">
            {strings.pairGuest.instruction}
          </AppText>
        </View>
      )}

      {developerMode ? (
        <View testID="card-paste-pairing" style={{ gap: spacing.md }}>
          <SectionHeading icon="wrench" color={colors.vermilion}>
            {strings.pairGuest.devHeading}
          </SectionHeading>
          <TextField
            testID="input-pairing-string"
            label={strings.pairGuest.devLabel}
            placeholder={strings.pairGuest.devPlaceholder}
            value={pasted}
            onChangeText={(text) => {
              setPasted(text);
              setNotice(null);
            }}
            multiline
          />
          <Button
            testID="btn-pair-paste"
            label={strings.pairGuest.devButton}
            variant="secondary"
            disabled={pasted.trim().length === 0}
            onPress={() => setNotice(strings.pairGuest.devPending)}
          />
          {notice ? <Banner testID="notice-paste">{notice}</Banner> : null}
        </View>
      ) : null}

      <Button testID="btn-pair-cancel" label={strings.pairGuest.cancel} variant="ghost" onPress={back} />
    </Screen>
  );
}
