import { View, useWindowDimensions } from 'react-native';

import { useAppStore } from '../../app/hooks';
import { useBack } from '../../app/navigationHooks';
import { SCREEN_TEST_IDS } from '../../app/routes';
import { strings } from '../../app/strings';
import { colors, gutter, spacing } from '../../app/theme';
import { AppText } from '../components/AppText';
import { Button } from '../components/Button';
import { SectionHeading, StatusPill } from '../components/Card';
import { Icon, type IconName } from '../components/Icon';
import { PairingPlate } from '../components/PairingPlate';
import { Rule } from '../components/Rule';
import { Screen } from '../components/Screen';
import { Stopwatch } from '../components/Stopwatch';

import { SAMPLE_PAIRING_STRING } from './qr';
import { RomanStepper } from './RomanStepper';

const HOW_TO_ICONS: IconName[] = ['phone', 'camera', 'bell'];

/** Host pairing: the pairing plate the partner scans. M0 renders a fixed sample to prove the renderer. */
export function PairHostScreen() {
  const back = useBack();
  const { width } = useWindowDimensions();
  const deviceName = useAppStore((s) => s.deviceName);
  const plateWidth = Math.min(width, 560) - 2 * gutter;

  return (
    <Screen
      testID={SCREEN_TEST_IDS.PairHost}
      eyebrow={strings.pairHost.eyebrow}
      title={strings.pairHost.title}
      onBack={back}
    >
      <RomanStepper steps={strings.pairHost.steps} active={0} />
      <View style={{ alignItems: 'center', gap: spacing.sm }}>
        <StatusPill tone="warning" label={strings.pairHost.sampleChip} testID="status-sample-code" />
        <PairingPlate
          testID="qr-code"
          value={SAMPLE_PAIRING_STRING}
          hostName={deviceName}
          width={plateWidth}
          accessibilityLabel={strings.pairHost.qrLabel}
        />
      </View>

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
            {strings.pairHost.privacy}
          </AppText>
        </View>
      </View>

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

      <Button testID="btn-pair-cancel" label={strings.pairHost.cancel} variant="ghost" onPress={back} />
    </Screen>
  );
}
