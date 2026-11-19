import { useMemo, useState } from 'react';
import { Share, View, useWindowDimensions } from 'react-native';

import IDENTITY from '../../../config/identity.json';
import { useDiagnosticsInput } from '../../app/hooks';
import { useBack } from '../../app/navigationHooks';
import { SCREEN_TEST_IDS } from '../../app/routes';
import { strings } from '../../app/strings';
import { colors, gutter, spacing } from '../../app/theme';
import { AppText, Legend } from '../components/AppText';
import { Banner, SectionHeading, StatusPill } from '../components/Card';
import { SubDial } from '../components/Dial/SubDial';
import { LevelBar } from '../components/LevelBar';
import { Plate } from '../components/Plate';
import { Rule } from '../components/Rule';
import { Screen } from '../components/Screen';

import { buildDiagnosticsSections, sectionsToText, type DiagRow } from './buildSections';

type ShareOutcome = 'shared' | 'unavailable' | null;

/**
 * Diagnostics: every section the brief lists (session, transport, interfaces, ICE candidates, link quality,
 * levels, audio route, battery, log) plus Share. M0 shows sample data (see the banner); M1 feeds live values
 * through `useDiagnosticsInput`. Share hands the text to the system share sheet, and falls back to showing the
 * text when no share target exists (web, or a phone without one).
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
  const linked = input.session?.state === 'connected';
  const checks = [
    {
      label: strings.diagnostics.checkLink,
      ok: linked,
      value: linked ? strings.ride.linkUp : strings.ride.linkSearching,
    },
    {
      label: strings.diagnostics.checkLoss,
      ok: (loss ?? 0) < 5,
      value: loss === null ? strings.common.notAvailable : `${loss.toFixed(1)} %`,
    },
    {
      label: strings.diagnostics.checkHeadset,
      ok: input.audio?.headsetConnected ?? false,
      value: input.audio?.headsetConnected ? strings.ride.earbudsOn : strings.ride.earbudsOff,
    },
  ];

  const onShare = async () => {
    const text = sectionsToText(`${IDENTITY.displayName} diagnostics`, input.generatedAt, sections);
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
      <Banner testID="banner-sample-data">{strings.placeholder.diagnostics}</Banner>

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
                    tone={check.ok ? 'success' : 'warning'}
                    label={`${check.ok ? strings.diagnostics.checkOk : strings.diagnostics.checkWarn} · ${check.value}`}
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
