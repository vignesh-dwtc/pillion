import { Fragment, type ReactElement } from 'react';
import { View } from 'react-native';

import { useAppStore, useRidePreview } from '../../app/hooks';
import { RIDE_PREVIEWS } from '../../app/preview';
import { useBack } from '../../app/navigationHooks';
import { formatKbps } from '../../app/format';
import { SCREEN_TEST_IDS } from '../../app/routes';
import { strings } from '../../app/strings';
import { colors, spacing } from '../../app/theme';
import { AUDIO_TUNABLE_LIMITS } from '../../platform/audio/AudioTunables';
import { AppText } from '../components/AppText';
import { Button } from '../components/Button';
import { Banner, Card, Divider, SectionHeading, StatusPill } from '../components/Card';
import { ChoiceRow, type Choice } from '../components/ChoiceRow';
import { Rule } from '../components/Rule';
import { Screen } from '../components/Screen';
import { Stepper } from '../components/Stepper';
import { ToggleRow } from '../components/ToggleRow';

import {
  BITRATE_PRESETS,
  OPUS_TUNABLES,
  PROCESSING_TUNABLES,
  TUNABLE_COPY,
  changedTunables,
  stepBitrate,
  type BooleanTunable,
} from './tunableFields';

const PACKET_TIME_CHOICES: Choice<number>[] = AUDIO_TUNABLE_LIMITS.opusPacketTimeMs.map((ms) => ({
  value: ms,
  label: String(ms),
  accessibilityLabel: `${ms} milliseconds`,
  testID: `choice-packet-${ms}`,
}));

const BITRATE_CHOICES: Choice<number>[] = BITRATE_PRESETS.map((bps) => ({
  value: bps,
  label: `${bps / 1000}k`,
  accessibilityLabel: formatKbps(bps),
  testID: `choice-bitrate-${bps}`,
}));

/**
 * Hidden developer screen (7 taps on the version label). The audio tunables editor applies every change
 * immediately and persists it; developer mode gates the overrides below it.
 */
export function DebugScreen() {
  const back = useBack();
  const tunables = useAppStore((s) => s.tunables);
  const setTunables = useAppStore((s) => s.setTunables);
  const resetTunables = useAppStore((s) => s.resetTunables);
  const developerMode = useAppStore((s) => s.developerMode);
  const allowNoHeadset = useAppStore((s) => s.allowNoHeadset);
  const setAllowNoHeadset = useAppStore((s) => s.setAllowNoHeadset);

  const [preview, setPreview] = useRidePreview();
  const overridesActive = developerMode && allowNoHeadset;
  const changed = changedTunables(tunables);
  const bitrate = tunables.opusBitrateBps;
  const { min, max } = AUDIO_TUNABLE_LIMITS.opusBitrateBps;

  const toggle = (key: BooleanTunable) => (
    <ToggleRow
      key={key}
      testID={`toggle-${key}`}
      label={TUNABLE_COPY[key].label}
      hint={TUNABLE_COPY[key].hint}
      value={tunables[key]}
      onValueChange={(value) => setTunables({ [key]: value })}
    />
  );

  /** Hairline rules between rotary rows, as on Settings. */
  const ruled = (rows: ReactElement[]) =>
    rows.map((row, i) => (
      <Fragment key={row.key}>
        {i > 0 ? <Rule /> : null}
        {row}
      </Fragment>
    ));

  return (
    <Screen
      testID={SCREEN_TEST_IDS.Debug}
      eyebrow={strings.debug.eyebrow}
      title={strings.debug.title}
      subtitle={strings.debug.intro}
      onBack={back}
    >
      {overridesActive ? (
        <Banner testID="banner-overrides-active" tone="danger">
          {strings.debug.overridesActive}
        </Banner>
      ) : null}
      <View aria-live="polite" role="status">
        <StatusPill
          tone={developerMode ? 'success' : 'warning'}
          label={developerMode ? strings.settings.developerModeEnabled : strings.debug.developerModeOff}
          testID="status-developer-mode"
        />
      </View>

      <Card testID="card-tunables">
        <SectionHeading icon="pulse">{strings.debug.tunablesHeading}</SectionHeading>
        <AppText variant="caption" color={colors.textMuted} testID="text-changed-tunables">
          {changed.length === 0
            ? strings.debug.allDefaults
            : `${strings.debug.changed}: ${changed.map((key) => TUNABLE_COPY[key].label).join(', ')}`}
        </AppText>

        {ruled(PROCESSING_TUNABLES.map(toggle))}
        <Divider />

        <Stepper
          testID="stepper-bitrate"
          label={TUNABLE_COPY.opusBitrateBps.label}
          hint={`${TUNABLE_COPY.opusBitrateBps.hint} (${formatKbps(min)} to ${formatKbps(max)})`}
          valueText={formatKbps(bitrate)}
          decrementLabel={`${strings.debug.stepDown} ${TUNABLE_COPY.opusBitrateBps.label}`}
          incrementLabel={`${strings.debug.stepUp} ${TUNABLE_COPY.opusBitrateBps.label}`}
          decrementDisabled={bitrate <= min}
          incrementDisabled={bitrate >= max}
          onDecrement={() => setTunables({ opusBitrateBps: stepBitrate(bitrate, -1) })}
          onIncrement={() => setTunables({ opusBitrateBps: stepBitrate(bitrate, 1) })}
        />
        <ChoiceRow
          testID="choice-bitrate"
          label={strings.debug.bitratePresets}
          choices={BITRATE_CHOICES}
          value={bitrate}
          onChange={(value) => setTunables({ opusBitrateBps: value })}
        />
        <Divider />

        {ruled(OPUS_TUNABLES.map(toggle))}
        <Divider />

        <ChoiceRow
          testID="choice-packet-time"
          label={`${TUNABLE_COPY.opusPacketTimeMs.label} (ms)`}
          hint={TUNABLE_COPY.opusPacketTimeMs.hint}
          choices={PACKET_TIME_CHOICES}
          value={tunables.opusPacketTimeMs}
          onChange={(value) => setTunables({ opusPacketTimeMs: value as typeof tunables.opusPacketTimeMs })}
        />

        <Button
          testID="btn-reset-tunables"
          label={strings.debug.reset}
          variant="secondary"
          icon="reset"
          disabled={changed.length === 0}
          onPress={resetTunables}
        />
      </Card>

      <Card testID="card-preview">
        <SectionHeading icon="motorcycle">{strings.debug.previewHeading}</SectionHeading>
        <ChoiceRow
          testID="choice-ride-preview"
          label={strings.debug.previewHint}
          choices={RIDE_PREVIEWS.map((value) => ({
            value,
            label: strings.debug.previewStates[value],
            testID: `choice-preview-${value}`,
          }))}
          value={preview}
          onChange={setPreview}
        />
      </Card>

      <Card testID="card-overrides">
        <SectionHeading icon="wrench" color={colors.vermilion}>
          {strings.debug.overridesHeading}
        </SectionHeading>
        {developerMode ? null : (
          <Banner testID="banner-overrides-locked">{strings.debug.overridesLocked}</Banner>
        )}
        <ToggleRow
          testID="toggle-allow-no-headset"
          label={strings.debug.allowNoHeadset.label}
          hint={strings.debug.allowNoHeadset.hint}
          value={developerMode && allowNoHeadset}
          disabled={!developerMode}
          onValueChange={setAllowNoHeadset}
        />
      </Card>

      <View style={{ height: spacing.lg }} />
    </Screen>
  );
}
