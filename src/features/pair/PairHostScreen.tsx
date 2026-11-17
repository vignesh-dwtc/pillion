import { View, useWindowDimensions } from 'react-native';

import { useBack } from '../../app/navigationHooks';
import { SCREEN_TEST_IDS } from '../../app/routes';
import { strings } from '../../app/strings';
import { spacing } from '../../app/theme';
import { Button } from '../components/Button';
import { Card, StatusPill } from '../components/Card';
import { Screen } from '../components/Screen';

import { QrCode } from './QrCode';
import { SAMPLE_PAIRING_STRING } from './qr';

const MAX_QR_SIZE = 320;

/** Host pairing: shows the QR the partner scans. M0 renders a fixed sample to prove the renderer. */
export function PairHostScreen() {
  const back = useBack();
  const { width } = useWindowDimensions();
  // Screen padding and card padding on both sides.
  const qrSize = Math.max(200, Math.min(MAX_QR_SIZE, width - 4 * spacing.lg));

  return (
    <Screen
      testID={SCREEN_TEST_IDS.PairHost}
      title={strings.pairHost.title}
      subtitle={strings.pairHost.instruction}
      onBack={back}
    >
      <Card style={{ alignItems: 'center' }}>
        <View style={{ alignSelf: 'stretch', alignItems: 'center' }}>
          <StatusPill tone="warning" label={strings.pairHost.sampleChip} testID="status-sample-code" />
        </View>
        <QrCode
          testID="qr-code"
          value={SAMPLE_PAIRING_STRING}
          size={qrSize}
          accessibilityLabel={strings.pairHost.qrLabel}
        />
      </Card>

      <View aria-live="polite" role="status">
        <StatusPill tone="info" icon="clock" label={strings.pairHost.waiting} testID="status-waiting" />
      </View>

      <Button testID="btn-pair-cancel" label={strings.pairHost.cancel} variant="ghost" onPress={back} />
    </Screen>
  );
}
