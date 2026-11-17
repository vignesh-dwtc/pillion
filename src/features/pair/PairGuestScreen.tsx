import { useState } from 'react';
import { useWindowDimensions } from 'react-native';

import { useAppStore } from '../../app/hooks';
import { useBack } from '../../app/navigationHooks';
import { SCREEN_TEST_IDS } from '../../app/routes';
import { strings } from '../../app/strings';
import { spacing } from '../../app/theme';
import { Button } from '../components/Button';
import { Banner, Card, SectionHeading } from '../components/Card';
import { Screen } from '../components/Screen';
import { TextField } from '../components/TextField';

import { Viewfinder } from './Viewfinder';

const MAX_VIEWFINDER = 340;

/**
 * Guest pairing: scans the host's QR. M0 shows the viewfinder placeholder; the "paste pairing string" path exists
 * only in developer mode (DECISIONS D-022) and does not save anything yet.
 */
export function PairGuestScreen() {
  const back = useBack();
  const { width } = useWindowDimensions();
  const developerMode = useAppStore((s) => s.developerMode);
  const [pasted, setPasted] = useState('');
  const [notice, setNotice] = useState<string | null>(null);
  const size = Math.max(220, Math.min(MAX_VIEWFINDER, width - 2 * spacing.lg));

  return (
    <Screen
      testID={SCREEN_TEST_IDS.PairGuest}
      title={strings.pairGuest.title}
      subtitle={strings.pairGuest.instruction}
      onBack={back}
    >
      <Viewfinder
        testID="viewfinder"
        size={size}
        title={strings.pairGuest.viewfinder}
        note={strings.pairGuest.viewfinderNote}
        accessibilityLabel={strings.pairGuest.viewfinderLabel}
      />

      {developerMode ? (
        <Card testID="card-paste-pairing">
          <SectionHeading>{strings.pairGuest.devHeading}</SectionHeading>
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
        </Card>
      ) : null}

      <Button testID="btn-pair-cancel" label={strings.pairGuest.cancel} variant="ghost" onPress={back} />
    </Screen>
  );
}
