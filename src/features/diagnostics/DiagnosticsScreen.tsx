import { useMemo, useState } from 'react';
import { Share, View, useWindowDimensions } from 'react-native';

import IDENTITY from '../../../config/identity.json';
import { formatDiagnosticsReport } from '../../core/diagnostics';
import { useDiagnosticsInput } from '../../app/hooks';
import { useBack } from '../../app/navigationHooks';
import { SCREEN_TEST_IDS } from '../../app/routes';
import { strings } from '../../app/strings';
import { colors, gutter, spacing, type Tone } from '../../app/theme';
import { AppText, Legend } from '../components/AppText';
import { SectionHeading, StatusPill } from '../components/Card';
import { SubDial } from '../components/Dial/SubDial';
import { LevelBar } from '../components/LevelBar';
import { Plate } from '../components/Plate';
import { Rule } from '../components/Rule';
import { Screen } from '../components/Screen';

import { buildDiagnosticsSections, type DiagRow } from './buildSections';

type ShareOutcome = 'shared' | 'unavailable' | null;

/**
 * Diagnostics: every section the brief lists (session, transport, interfaces, ICE candidates, link quality,
 * levels, audio route, battery, log) plus Share, all live from `useDiagnosticsInput` (session snapshot, one-second
 * media sample, audio route, interfaces, battery, ring log). Share hands core's `formatDiagnosticsReport` text to the
 * system share sheet (it never contains the pairing secret or the passphrase), and falls back to showing the text when
 * no share target exists (web, or a phone without one).
 */
export function DiagnosticsScreen() {
  const back = useBack();
  const input = useDiagnosticsInput();
  const sections = useMemo(() => buildDiagnosticsSections(input), [input]);
  const [outcome, setOutcome] = useState<ShareOutcome>(null);
  const [reportText, setReportText] = useState<string | null>(null);
  const { width } = useWindowDimensions();
  const dial = Math.min(78, Math.floor((Math.min(width, 560) - 2 * gutter - 3 * spacing.sm) / 4));
  const sample = input.sample;
  const level = sample?.inputLevel ?? null;
  const loss = sample?.lossPct ?? null;
  const state = input.session?.state ?? 'idle';
  const rideLive = state !== 'idle' && state !== 'ended';
  const headset = input.audio?.headsetConnected ?? null;
  // Three states, never colour alone: OK, Check, or no verdict (no ride / no data yet) shown neutral without a prefix.
  const checks: { label: string; tone: Tone; value: string; testID: string }[] = [
    {
      label: strings.diagnostics.checkLink,
      tone: state === 'connected' ? 'success' : rideLive ? 'warning' : 'neutral',
      value: strings.ride.states[state],
      testID: 'check-link',
    },
    {
      label: strings.diagnostics.checkLoss,
      tone: loss === null ? 'neutral' : loss < 5 ? 'success' : 'warning',
      value: loss === null ? strings.common.notAvailable : `${loss.toFixed(1)} %`,
      testID: 'check-loss',
    },
    {
      label: strings.diagnostics.checkHeadset,
      tone: headset === null ? 'neutral' : headset ? 'success' : 'warning',
      value:
        headset === null
          ? strings.home.earbudsChecking
          : headset
            ? strings.ride.earbudsOn
            : strings.ride.earbudsOff,
      testID: 'check-headset',
    },
  ];
  const verdict = (tone: Tone): string | null =>
    tone === 'success'
      ? strings.diagnostics.checkOk
      : tone === 'neutral'
        ? null
        : strings.diagnostics.checkWarn;

  const onShare = async () => {
    const text = formatDiagnosticsReport({ ...input, generatedAt: Date.now() });
    try {
      await Share.share({ title: `${IDENTITY.displayName} diagnostics`, message: text });
      setOutcome('shared');
      setReportText(null);
    } catch {
      setOutcome('unavailable');
      setReportText(text);
    }
  };

  return (
    <Screen
      testID={SCREEN_TEST_IDS.Diagnostics}
      eyebrow={strings.diagnostics.eyebrow}
      title={strings.diagnostics.title}
      onBack={back}
      footer={
        <Plate
          testID="btn-share-diagnostics"
          label={strings.diagnostics.share}
          icon="share"
          chevron
          onPress={() => void onShare()}
        />
      }
    >
      <View style={{ flexDirection: 'row', justifyContent: 'space-between' }} testID="diag-dials">
        {[
          {
            legend: strings.diagnostics.rtt,
            value: sample?.rttMs ?? null,
            unit: 'ms',
            level: typeof sample?.rttMs === 'number' ? Math.min(1, sample.rttMs / 200) : null,
          },
          {
            legend: strings.diagnostics.jitter,
            value: sample?.jitterMs ?? null,
            unit: 'ms',
            level: typeof sample?.jitterMs === 'number' ? Math.min(1, sample.jitterMs / 60) : null,
          },
          {
            legend: strings.diagnostics.loss,
            value: loss,
            unit: '%',
            level: loss === null ? null : Math.min(1, loss / 10),
          },
          {
            legend: strings.diagnostics.level,
            value: level === null ? null : Math.round(level * 100),
            unit: '%',
            level,
          },
        ].map((d) => (
          <View
            key={d.legend}
            accessible
            aria-label={`${d.legend}: ${d.value === null ? strings.common.notAvailable : `${d.value} ${d.unit}`}`}
          >
            <SubDial
              size={dial}
              value={
                d.value === null
                  ? strings.common.notAvailable
                  : String(Number.isInteger(d.value) ? d.value : d.value.toFixed(1))
              }
              unit={d.value === null ? undefined : d.unit}
              legend={d.legend}
              level={d.level}
            />
          </View>
        ))}
      </View>

      <View style={{ gap: spacing.sm }}>
        <SectionHeading icon="shield-check">{strings.diagnostics.checksHeading}</SectionHeading>
        <View>
          {checks.map((check) => (
            <View key={check.label}>
              <Rule />
              <View style={{ flexDirection: 'row', alignItems: 'center', minHeight: 48, gap: spacing.md }}>
                <AppText variant="bodyLarge" style={{ flex: 1 }}>
                  {check.label}
                </AppText>
                <View>
                  <StatusPill
                    testID={check.testID}
                    tone={check.tone}
                    label={verdict(check.tone) ? `${verdict(check.tone)} · ${check.value}` : check.value}
                  />
                </View>
              </View>
            </View>
          ))}
          <Rule />
        </View>
      </View>

      <AppText variant="caption" color={colors.textSubtle}>
        {strings.diagnostics.shareHint}
      </AppText>

      {sections.map((section) => (
        <View key={section.id} testID={`diag-${section.id}`} style={{ gap: spacing.xs }}>
          <SectionHeading>{section.title}</SectionHeading>
          {section.rows.map((row, index) => (
            <Row key={`${row.label}-${index}`} row={row} testID={`diag-${section.id}-${index}`} />
          ))}
        </View>
      ))}

      <View aria-live="polite" role="status">
        {outcome === 'shared' ? (
          <StatusPill tone="success" label={strings.diagnostics.shared} testID="status-share" />
        ) : null}
        {outcome === 'unavailable' ? (
          <StatusPill tone="warning" label={strings.diagnostics.shareUnavailable} testID="status-share" />
        ) : null}
      </View>

      {reportText ? (
        <View testID="report-text" style={{ gap: spacing.sm }}>
          <SectionHeading>{strings.diagnostics.reportHeading}</SectionHeading>
          <AppText variant="mono" selectable color={colors.textMuted}>
            {reportText}
          </AppText>
        </View>
      ) : null}
    </Screen>
  );
}

function Row({ row, testID }: { row: DiagRow; testID: string }) {
  if (row.heading) {
    return (
      <View style={{ paddingTop: spacing.sm }}>
        <Legend color={colors.brass} style={{ fontSize: 11, letterSpacing: 2 }}>
          {row.label}
        </Legend>
      </View>
    );
  }
  if (row.value === '') {
    return (
      <AppText variant="caption" color={colors.textSubtle} testID={testID}>
        {row.label}
      </AppText>
    );
  }
  if (row.stacked) {
    return (
      <View
        testID={testID}
        style={{ gap: 2, paddingVertical: 4, borderBottomWidth: 1, borderColor: colors.hairline }}
      >
        <AppText variant="caption" color={colors.textSubtle}>
          {row.label}
        </AppText>
        <AppText variant="mono" selectable>
          {row.value}
        </AppText>
      </View>
    );
  }
  return (
    <View
      testID={testID}
      style={{ gap: spacing.xs, paddingVertical: 6, borderBottomWidth: 1, borderColor: colors.hairline }}
    >
      <View style={{ flexDirection: 'row', gap: spacing.md, alignItems: 'flex-start' }}>
        <AppText variant="body" color={colors.textMuted} style={{ flex: 2 }}>
          {row.label}
        </AppText>
        <AppText variant={row.mono ? 'mono' : 'value'} selectable align="right" style={{ flex: 3 }}>
          {row.value}
        </AppText>
      </View>
      {row.level !== undefined ? <LevelBar level={row.level} /> : null}
    </View>
  );
}
