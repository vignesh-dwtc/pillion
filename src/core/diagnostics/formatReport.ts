import IDENTITY from '../../../config/identity.json';
import type { AudioRouteState } from '../../platform/audio/AudioRoute';
import type { IceCandidateInfo, MediaStats } from '../../platform/media/MediaEngine';
import type { PeerState, SessionSnapshot } from '../session/types';
import { MAX_MESSAGE_CHARS, cleanText, redactData, redactText, type RedactOptions } from './redact';
import type { DiagnosticsReportInput, FormatDiagnosticsReport, LogEntry } from './types';

/**
 * Plain-text diagnostics export for the system share sheet.
 *
 * Deterministic: the output is a pure function of the input (no clock, no locale, no object-order dependence:
 * tunables and log data keys are sorted), so a report can be compared, diffed and tested exactly.
 *
 * Never contains secrets: `DiagnosticsReportInput` cannot carry a pairing record by type, log entries are
 * re-redacted on the way out (keys and 32-byte-secret-looking values), and the finished text is passed through the
 * same value redaction once more. Only the first 8 characters of the (non-secret) pair id are printed.
 */

const NONE = 'none';
const UNKNOWN = 'unknown';

function yesNo(value: boolean | null | undefined): string {
  if (value === null || value === undefined) return UNKNOWN;
  return value ? 'yes' : 'no';
}

function iso(ms: number | null | undefined): string {
  if (typeof ms !== 'number' || !Number.isFinite(ms)) return UNKNOWN;
  const date = new Date(ms);
  return Number.isNaN(date.getTime()) ? UNKNOWN : date.toISOString();
}

function num(value: number | null | undefined, decimals = 0): string {
  if (typeof value !== 'number' || !Number.isFinite(value)) return UNKNOWN;
  return value.toFixed(decimals);
}

function text(value: string | null | undefined): string {
  return value === null || value === undefined || value === '' ? UNKNOWN : value;
}

/** "1h 02m 03s" style duration. */
function duration(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h > 0) return `${h}h ${String(m).padStart(2, '0')}m ${String(s).padStart(2, '0')}s`;
  if (m > 0) return `${m}m ${String(s).padStart(2, '0')}s`;
  return `${s}s`;
}

function candidateLine(c: IceCandidateInfo): string {
  const where = c.address ? `${c.address}${c.port === null ? '' : `:${c.port}`}` : UNKNOWN;
  return `${c.type} ${c.protocol} ${where} (${text(c.networkType)}) id=${c.id}`;
}

function formatPeer(peer: PeerState | null, generatedAt: number): string {
  if (!peer) return NONE;
  const battery = peer.batteryPct === null ? UNKNOWN : `${peer.batteryPct}%`;
  const age = generatedAt >= peer.updatedAt ? ` (${duration(generatedAt - peer.updatedAt)} ago)` : '';
  return (
    `${text(peer.name)}; muted ${yesNo(peer.muted)}; headset ${yesNo(peer.headsetConnected)}; ` +
    `battery ${battery} (charging ${yesNo(peer.charging)}); interruption ${peer.interruption}; updated ${iso(peer.updatedAt)}${age}`
  );
}

function sessionLines(s: SessionSnapshot, generatedAt: number): string[] {
  const lines = [
    `State: ${s.state}`,
    `Role: ${text(s.role)}`,
    `Pair id: ${s.pairId ? `${s.pairId.slice(0, 8)}...` : NONE}`,
    `Transport: ${text(s.transport)}`,
    `Generation: ${s.generation}`,
    `Failed attempts in this outage: ${s.attempt}`,
    `Muted: ${yesNo(s.muted)}`,
    s.connectedAt === null
      ? 'Connected since: not connected'
      : `Connected since: ${iso(s.connectedAt)} (up ${duration(generatedAt - s.connectedAt)})`,
    `Local headset: ${yesNo(s.local.headsetConnected)}; interruption ${s.local.interruption}; battery ${
      s.local.batteryPct === null ? UNKNOWN : `${s.local.batteryPct}%`
    }`,
    `Partner: ${formatPeer(s.peer, generatedAt)}`,
  ];
  if (s.error) {
    lines.push(
      `Error: ${s.error.code} (${s.error.recoverable ? 'recoverable' : 'ended the ride'}) at ${iso(s.error.at)}: ${s.error.message}`,
    );
  } else {
    lines.push(`Error: ${NONE}`);
  }
  return lines;
}

function mediaLines(stats: MediaStats | null, input: DiagnosticsReportInput): string[] {
  if (!stats) return ['No media session.'];
  const lines = [
    `State: ${stats.connectionState}`,
    `Codec: ${text(stats.codec)}`,
    stats.selectedPair
      ? `Selected pair: ${candidateLine(stats.selectedPair.local)} <-> ${candidateLine(stats.selectedPair.remote)}; state ${stats.selectedPair.state}; rtt ${num(stats.selectedPair.rttMs)} ms`
      : 'Selected pair: none',
    `RTT: ${num(stats.rttMs)} ms; jitter: ${num(stats.jitterMs, 1)} ms`,
    `Packets: sent ${stats.packetsSent}, received ${stats.packetsReceived}, lost ${stats.packetsLost}`,
    `Bytes: sent ${stats.bytesSent}, received ${stats.bytesReceived}`,
    `Levels: input ${num(stats.inputLevel, 2)}, output ${num(stats.outputLevel, 2)}`,
    `Local candidates (${stats.localCandidates.length}):`,
    ...stats.localCandidates.map((c) => `  ${candidateLine(c)}`),
    `Remote candidates (${stats.remoteCandidates.length}):`,
    ...stats.remoteCandidates.map((c) => `  ${candidateLine(c)}`),
  ];
  const sample = input.sample;
  if (sample) {
    lines.push(
      `Rates at ${iso(sample.t)}: out ${num(sample.bitrateOutKbps, 1)} kbit/s, in ${num(sample.bitrateInKbps, 1)} kbit/s, loss ${num(sample.lossPct, 2)} %`,
    );
  }
  return lines;
}

function audioLines(audio: AudioRouteState | null): string[] {
  if (!audio) return ['Not available.'];
  const active = audio.devices.find((d) => d.id === audio.activeDeviceId);
  return [
    `Status: ${audio.status}; communication mode ${yesNo(audio.communicationMode)}`,
    `Headset connected: ${yesNo(audio.headsetConnected)}; using fallback device: ${yesNo(audio.usingFallback)}`,
    `Active device: ${active ? `${active.name} (${active.kind}, mic ${yesNo(active.hasMic)})` : NONE}`,
    `Devices (${audio.devices.length}):`,
    ...audio.devices.map((d) => `  ${d.name} (${d.kind}, mic ${yesNo(d.hasMic)}) id=${d.id}`),
    `Error: ${audio.error ? audio.error : NONE}`,
  ];
}

function formatValue(value: string | number | boolean | null | undefined): string {
  if (typeof value === 'string') return /^[^\s"=]+$/.test(value) ? value : JSON.stringify(value);
  return String(value);
}

function logLine(entry: LogEntry, redact: RedactOptions): string {
  const data = redactData(entry.data, redact);
  const pairs = data
    ? Object.keys(data)
        .sort()
        .map((key) => `${key}=${formatValue(data[key])}`)
    : [];
  const level = entry.level.toUpperCase().padEnd(5, ' ');
  const tag = cleanText(entry.tag, 48, redact);
  const message = cleanText(entry.message, MAX_MESSAGE_CHARS, redact);
  return `${iso(entry.t)} ${level} ${tag}  ${message}${pairs.length > 0 ? `  ${pairs.join(' ')}` : ''}`;
}

export const formatDiagnosticsReport: FormatDiagnosticsReport = (input: DiagnosticsReportInput): string => {
  const redact: RedactOptions = {};
  const out: string[] = [];
  const section = (title: string, lines: string[]): void => {
    out.push('', `== ${title} ==`, ...lines);
  };

  out.push(
    `${IDENTITY.displayName} diagnostics report`,
    `Generated: ${iso(input.generatedAt)}`,
    `App version: ${text(input.appVersion)}`,
    `Platform: ${text(input.platform)}; OS version: ${text(input.osVersion)}; device: ${text(input.deviceModel)}`,
  );
  section('Session', sessionLines(input.session, input.generatedAt));
  section(
    'Network interfaces',
    input.interfaces.length === 0
      ? ['No interfaces reported.']
      : input.interfaces.map(
          (i) =>
            `${i.name} [${i.kind}] ${i.up ? 'up' : 'down'}, multicast ${yesNo(i.multicast)}: ${
              i.addresses.length > 0 ? i.addresses.join(', ') : 'no addresses'
            }`,
        ),
  );
  section('Media', mediaLines(input.stats, input));
  section('Audio route', audioLines(input.audio));
  section('Battery', [
    input.battery
      ? `${num(input.battery.levelPct)}% (charging ${yesNo(input.battery.charging)})`
      : 'Not available.',
  ]);
  section(
    'Audio tunables',
    Object.keys(input.tunables)
      .sort()
      .map((key) => `${key}: ${String((input.tunables as unknown as Record<string, unknown>)[key])}`),
  );
  section(
    `Log (${input.log.length} entries, oldest first)`,
    input.log.map((entry) => logLine(entry, redact)),
  );

  // Last line of defence: no 32-byte-secret-looking token survives in the finished text.
  return `${redactText(out.join('\n'))}\n`;
};
