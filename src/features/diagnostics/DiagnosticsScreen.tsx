import { useMemo, useState } from 'react';
import { Share, View } from 'react-native';

import IDENTITY from '../../../config/identity.json';
import { useDiagnosticsInput } from '../../app/hooks';
import { useBack } from '../../app/navigationHooks';
import { SCREEN_TEST_IDS } from '../../app/routes';
import { strings } from '../../app/strings';
import { colors, spacing } from '../../app/theme';
import { AppText } from '../components/AppText';
import { Button } from '../components/Button';
import { Banner, Card, Divider, SectionHeading, StatusPill } from '../components/Card';
import { LevelBar } from '../components/LevelBar';
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
      title={strings.diagnostics.title}
      onBack={back}
      footer={
        <Button
          testID="btn-share-diagnostics"
          label={strings.diagnostics.share}
          icon="share"
          variant="primary"
          size="lg"
          onPress={() => void onShare()}
        />
      }
    >
      <Banner testID="banner-sample-data">{strings.placeholder.diagnostics}</Banner>
      <AppText variant="label" color={colors.textMuted}>
        {strings.diagnostics.shareHint}
      </AppText>

      {sections.map((section) => (
        <Card key={section.id} testID={`diag-${section.id}`}>
          <SectionHeading>{section.title}</SectionHeading>
          {section.rows.map((row, index) => (
            <Row key={`${row.label}-${index}`} row={row} testID={`diag-${section.id}-${index}`} />
          ))}
        </Card>
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
        <Card testID="report-text">
          <SectionHeading>{strings.diagnostics.reportHeading}</SectionHeading>
          <AppText variant="mono" selectable color={colors.textMuted}>
            {reportText}
          </AppText>
        </Card>
      ) : null}
    </Screen>
  );
}

function Row({ row, testID }: { row: DiagRow; testID: string }) {
  if (row.heading) {
    return (
      <View style={{ gap: spacing.xs, paddingTop: spacing.sm }}>
        <Divider />
        <AppText variant="label" color={colors.info} style={{ fontWeight: '700' }}>
          {row.label}
        </AppText>
      </View>
    );
  }
  if (row.value === '') {
    return (
      <AppText variant="label" color={colors.textMuted} testID={testID}>
        {row.label}
      </AppText>
    );
  }
  if (row.stacked) {
    return (
      <View testID={testID} style={{ gap: 2 }}>
        <AppText variant="mono" color={colors.textMuted}>
          {row.label}
        </AppText>
        <AppText variant="mono" selectable>
          {row.value}
        </AppText>
      </View>
    );
  }
  return (
    <View testID={testID} style={{ gap: spacing.xs }}>
      <View style={{ flexDirection: 'row', gap: spacing.md, alignItems: 'flex-start' }}>
        <AppText variant="label" color={colors.textMuted} style={{ flex: 2 }}>
          {row.label}
        </AppText>
        <AppText
          variant={row.mono ? 'mono' : 'label'}
          selectable
          align="right"
          style={{ flex: 3, fontWeight: row.mono ? '400' : '700' }}
        >
          {row.value}
        </AppText>
      </View>
      {row.level !== undefined ? <LevelBar level={row.level} /> : null}
    </View>
  );
}
