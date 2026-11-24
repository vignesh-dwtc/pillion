import type { DiagnosticsReportInput, LogEntry } from '../../core/diagnostics/types';
import type { LinkKind } from '../../platform/link/LinkTransport';
import type { IceCandidateInfo } from '../../platform/media/MediaEngine';
import {
  formatClock,
  formatDuration,
  formatKbps,
  formatLevel,
  formatMs,
  formatPercent,
} from '../../app/format';
import { strings } from '../../app/strings';

/**
 * View-model for the diagnostics screen. One pure function turns the report input (the same shape the share export
 * uses) into titled sections of label/value rows for the screen. The share action exports core's
 * `formatDiagnosticsReport` of the same input; `sectionsToText` remains for tests and debugging.
 */

export interface DiagRow {
  label: string;
  value: string;
  /** Sub-heading inside a section (value is empty). */
  heading?: boolean;
  mono?: boolean;
  /** Value under the label, left aligned (long lines such as the log). */
  stacked?: boolean;
  /** 0..1: draws a level bar under the row. */
  level?: number | null;
}

export interface DiagSection {
  id:
    | 'app'
    | 'session'
    | 'transport'
    | 'interfaces'
    | 'ice'
    | 'quality'
    | 'levels'
    | 'route'
    | 'battery'
    | 'log';
  title: string;
  rows: DiagRow[];
}

const NA = strings.common.notAvailable;
const LOG_TAIL = 20;

const yesNo = (value: boolean): string => (value ? strings.common.yes : strings.common.no);

export const TRANSPORT_LABEL: Record<LinkKind, string> = {
  lan: 'LAN (shared Wi-Fi)',
  'wifi-direct': 'Wi-Fi Direct',
  'web-relay': 'Web relay (development)',
  memory: 'In-memory (test)',
};

/** StatsSample carries kbps; `formatKbps` takes bits per second. */
function kbpsToBps(kbps: number | null | undefined): number | null {
  return typeof kbps === 'number' ? kbps * 1000 : null;
}

function candidateText(c: IceCandidateInfo): string {
  const where = c.address ? `${c.address}${c.port !== null ? `:${c.port}` : ''}` : NA;
  return `${where}${c.networkType ? ` (${c.networkType})` : ''}`;
}

function candidateRow(c: IceCandidateInfo): DiagRow {
  return { label: `${c.type} ${c.protocol}`, value: candidateText(c), mono: true };
}

function dataText(data: LogEntry['data']): string {
  if (!data) return '';
  const pairs = Object.entries(data)
    .filter(([, v]) => v !== undefined)
    .map(([k, v]) => `${k}=${String(v)}`);
  return pairs.length > 0 ? ` {${pairs.join(' ')}}` : '';
}

export function buildDiagnosticsSections(input: DiagnosticsReportInput): DiagSection[] {
  const { session, stats, sample, audio, battery } = input;
  const peer = session.peer;
  const names = strings.diagnostics.sections;

  const connectedFor =
    session.connectedAt !== null ? formatDuration(input.generatedAt - session.connectedAt) : 'not connected';

  const sessionRows: DiagRow[] = [
    { label: 'State', value: session.state },
    { label: 'Role', value: session.role ?? NA },
    { label: 'Pair id', value: session.pairId ?? NA, mono: true },
    { label: 'Connected for', value: connectedFor },
    { label: 'Generation', value: String(session.generation) },
    { label: 'Failed attempts', value: String(session.attempt) },
    { label: 'You are muted', value: yesNo(session.muted) },
    { label: 'Your headset', value: yesNo(session.local.headsetConnected) },
    { label: 'Your interruption', value: session.local.interruption },
    {
      label: 'Last error',
      value: session.error ? `${session.error.code}: ${session.error.message}` : 'none',
    },
  ];
  if (session.error) {
    sessionRows.push({ label: 'Error recoverable', value: yesNo(session.error.recoverable) });
  }
  if (peer) {
    sessionRows.push(
      { label: 'Partner', value: peer.name },
      { label: 'Partner muted', value: yesNo(peer.muted) },
      { label: 'Partner headset', value: yesNo(peer.headsetConnected) },
      { label: 'Partner interruption', value: peer.interruption },
      {
        label: 'Partner battery',
        value:
          peer.batteryPct === null
            ? NA
            : `${peer.batteryPct} %${peer.charging === null ? '' : peer.charging ? ' (charging)' : ''}`,
      },
    );
  } else {
    sessionRows.push({ label: 'Partner', value: 'no state received yet' });
  }

  const pair = stats?.selectedPair ?? null;
  const transportRows: DiagRow[] = [
    { label: 'Transport', value: session.transport ? TRANSPORT_LABEL[session.transport] : 'none' },
    { label: 'ICE connection', value: stats?.connectionState ?? NA },
    { label: 'Selected local', value: pair ? candidateText(pair.local) : NA, mono: true },
    { label: 'Selected remote', value: pair ? candidateText(pair.remote) : NA, mono: true },
    { label: 'Selected pair state', value: pair ? pair.state : NA },
  ];

  const interfaceRows: DiagRow[] =
    input.interfaces.length > 0
      ? input.interfaces.map((i) => ({
          label: `${i.name} (${i.kind})`,
          value: [
            `${i.up ? 'up' : 'down'}, multicast ${i.multicast ? 'yes' : 'no'}`,
            ...(i.addresses.length > 0 ? i.addresses : ['no address']),
          ].join('\n'),
          mono: true,
        }))
      : [{ label: 'No interfaces reported', value: '' }];

  const local = stats?.localCandidates ?? [];
  const remote = stats?.remoteCandidates ?? [];
  const iceRows: DiagRow[] = [
    { label: `Gathered locally (${local.length})`, value: '', heading: true },
    ...(local.length > 0 ? local.map(candidateRow) : [{ label: 'none yet', value: '' }]),
    { label: `Received from partner (${remote.length})`, value: '', heading: true },
    ...(remote.length > 0 ? remote.map(candidateRow) : [{ label: 'none yet', value: '' }]),
    {
      label: 'Selected pair',
      value: pair ? `${candidateText(pair.local)} <-> ${candidateText(pair.remote)}` : 'none selected',
      mono: true,
    },
  ];

  const qualityRows: DiagRow[] = [
    { label: 'Round-trip time', value: formatMs(sample?.rttMs ?? stats?.rttMs ?? null) },
    { label: 'Jitter', value: formatMs(sample?.jitterMs ?? stats?.jitterMs ?? null) },
    { label: 'Packet loss', value: formatPercent(sample?.lossPct ?? null) },
    { label: 'Bitrate out', value: formatKbps(kbpsToBps(sample?.bitrateOutKbps)) },
    { label: 'Bitrate in', value: formatKbps(kbpsToBps(sample?.bitrateInKbps)) },
    { label: 'Codec', value: stats?.codec ?? NA },
    {
      label: 'Packets sent / received / lost',
      value: stats ? `${stats.packetsSent} / ${stats.packetsReceived} / ${stats.packetsLost}` : NA,
    },
  ];

  const inputLevel = sample?.inputLevel ?? stats?.inputLevel ?? null;
  const outputLevel = sample?.outputLevel ?? stats?.outputLevel ?? null;
  const levelRows: DiagRow[] = [
    { label: 'Input (your microphone)', value: formatLevel(inputLevel), level: inputLevel },
    { label: 'Output (partner audio)', value: formatLevel(outputLevel), level: outputLevel },
  ];

  const active = audio?.devices.find((d) => d.id === audio.activeDeviceId) ?? null;
  const routeRows: DiagRow[] = audio
    ? [
        { label: 'Status', value: audio.status },
        { label: 'Communication mode', value: yesNo(audio.communicationMode) },
        { label: 'Headset connected', value: yesNo(audio.headsetConnected) },
        { label: 'Active device', value: active ? `${active.name} (${active.kind})` : 'none' },
        { label: 'Earpiece/speaker override', value: yesNo(audio.usingFallback) },
        { label: 'Error', value: audio.error ?? 'none' },
        { label: `Devices (${audio.devices.length})`, value: '', heading: true },
        ...audio.devices.map((d) => ({
          label: d.name,
          value: `${d.kind}, microphone ${d.hasMic ? 'yes' : 'no'}`,
        })),
      ]
    : [{ label: 'Audio route', value: NA }];

  const batteryRows: DiagRow[] = battery
    ? [
        { label: 'Level', value: `${battery.levelPct} %` },
        { label: 'Charging', value: yesNo(battery.charging) },
      ]
    : [{ label: 'Battery', value: NA }];

  const tail = input.log.slice(-LOG_TAIL);
  const logRows: DiagRow[] =
    tail.length > 0
      ? tail.map((e) => ({
          label: formatClock(e.t),
          value: `${e.level.toUpperCase()} ${e.tag}: ${e.message}${dataText(e.data)}`,
          mono: true,
          stacked: true,
        }))
      : [{ label: 'No log entries yet', value: '' }];

  return [
    {
      id: 'app',
      title: 'App',
      rows: [
        { label: 'Version', value: input.appVersion },
        { label: 'Platform', value: input.platform },
        { label: 'OS version', value: input.osVersion ?? NA },
        { label: 'Device model', value: input.deviceModel ?? NA },
      ],
    },
    { id: 'session', title: names.session, rows: sessionRows },
    { id: 'transport', title: names.transport, rows: transportRows },
    { id: 'interfaces', title: names.interfaces, rows: interfaceRows },
    { id: 'ice', title: names.ice, rows: iceRows },
    { id: 'quality', title: names.quality, rows: qualityRows },
    { id: 'levels', title: names.levels, rows: levelRows },
    { id: 'route', title: names.route, rows: routeRows },
    { id: 'battery', title: names.battery, rows: batteryRows },
    { id: 'log', title: names.log, rows: logRows },
  ];
}

/** Plain text of the very same rows, for the system share sheet. */
export function sectionsToText(title: string, generatedAt: number, sections: DiagSection[]): string {
  const lines: string[] = [title, `Generated: ${new Date(generatedAt).toISOString()}`];
  for (const section of sections) {
    lines.push('', `== ${section.title} ==`);
    for (const row of section.rows) {
      if (row.heading) {
        lines.push(`-- ${row.label}`);
      } else if (row.value === '') {
        lines.push(row.label);
      } else if (row.value.includes('\n')) {
        lines.push(`${row.label}:`, ...row.value.split('\n').map((line) => `  ${line}`));
      } else {
        lines.push(`${row.label}: ${row.value}`);
      }
    }
  }
  return lines.join('\n');
}
