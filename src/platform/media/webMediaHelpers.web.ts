/**
 * Pure helpers for the web MediaEngine twin (DEV ONLY, never part of the Android bundle).
 *
 * MINIMAL LOCAL VERSIONS: the `media` subagent owns the shared tunables / Opus SDP / stats mapping for the native
 * engine. These stand-ins only cover what the browser target needs (Opus fmtp munging, mapping a Chromium
 * RTCStatsReport to MediaStats). Swap them for the shared modules once those exist; the unit tests next to this file
 * pin the behaviour either way.
 */
import type { AudioTunables } from '../audio/AudioTunables';

import type {
  IceCandidateInfo,
  MediaConnectionState,
  MediaStats,
  SelectedCandidatePair,
} from './MediaEngine';

/** Greppable by scripts/check-android-bundle.mjs: this string must never appear in the Android bundle. */
export const WEB_ONLY_MEDIA_HELPERS = '@@web-only:webMediaHelpers@@';

// ---- getUserMedia constraints ----------------------------------------------------------------------------

/**
 * Browser constraints for the tunables. `highpassFilter` has no standard constraint (Chromium's legacy
 * `googHighpassFilter` is gone), so it is ignored on web. Mono, 48 kHz is what Opus runs at anyway.
 */
export function audioConstraintsFor(tunables: AudioTunables): MediaTrackConstraints {
  return {
    channelCount: 1,
    echoCancellation: tunables.echoCancellation,
    noiseSuppression: tunables.noiseSuppression,
    autoGainControl: tunables.autoGainControl,
  };
}

// ---- Opus SDP munging ------------------------------------------------------------------------------------

function parseFmtp(line: string): Map<string, string> {
  const params = new Map<string, string>();
  const body = line.slice(line.indexOf(' ') + 1);
  for (const part of body.split(';')) {
    const trimmed = part.trim();
    if (trimmed === '') continue;
    const equals = trimmed.indexOf('=');
    if (equals === -1) params.set(trimmed, '');
    else params.set(trimmed.slice(0, equals), trimmed.slice(equals + 1));
  }
  return params;
}

function mungeAudioSection(lines: string[], tunables: AudioTunables): string[] {
  const rtpmapIndex = lines.findIndex((line) => /^a=rtpmap:\d+ opus\/48000/i.test(line));
  if (rtpmapIndex === -1) return lines;
  const payloadType = /^a=rtpmap:(\d+) /.exec(lines[rtpmapIndex] ?? '')?.[1];
  if (payloadType === undefined) return lines;

  const fmtpPrefix = `a=fmtp:${payloadType} `;
  const fmtpIndex = lines.findIndex((line) => line.startsWith(fmtpPrefix));
  const params = fmtpIndex === -1 ? new Map<string, string>() : parseFmtp(lines[fmtpIndex] ?? '');
  params.set('useinbandfec', tunables.opusFec ? '1' : '0');
  params.set('usedtx', tunables.opusDtx ? '1' : '0');
  params.set('maxaveragebitrate', String(Math.round(tunables.opusBitrateBps)));
  params.set('stereo', '0');
  params.set('sprop-stereo', '0');
  const fmtp = `${fmtpPrefix}${[...params].map(([key, value]) => (value === '' ? key : `${key}=${value}`)).join(';')}`;

  const withoutOld = lines.filter((line, index) => index !== fmtpIndex && !line.startsWith('a=ptime:'));
  const insertAfter = withoutOld.findIndex((line) => line === lines[rtpmapIndex]);
  withoutOld.splice(insertAfter + 1, 0, fmtp, `a=ptime:${tunables.opusPacketTimeMs}`);
  return withoutOld;
}

/**
 * Rewrites the Opus fmtp line of every audio m-section for the tunables: in-band FEC, DTX, average bitrate, mono,
 * packet time. Everything else in the SDP is left alone; an SDP without Opus is returned unchanged.
 */
export function mungeOpusSdp(sdp: string, tunables: AudioTunables): string {
  const eol = sdp.includes('\r\n') ? '\r\n' : '\n';
  const endsWithEol = sdp.endsWith(eol);
  const lines = sdp.split(/\r?\n/);
  if (endsWithEol) lines.pop();

  const out: string[] = [];
  let section: string[] = [];
  let sectionIsAudio = false;
  const flush = () => {
    out.push(...(sectionIsAudio ? mungeAudioSection(section, tunables) : section));
    section = [];
  };
  for (const line of lines) {
    if (line.startsWith('m=')) {
      flush();
      sectionIsAudio = line.startsWith('m=audio');
    }
    section.push(line);
  }
  flush();
  return out.join(eol) + (endsWithEol ? eol : '');
}

// ---- Stats mapping ---------------------------------------------------------------------------------------

type RawStat = Record<string, unknown>;

/** What both `RTCStatsReport` and a plain `Map` offer. */
export interface StatsReportLike {
  forEach(callback: (value: unknown, key: string) => void): void;
}

const num = (value: unknown): number | null =>
  typeof value === 'number' && Number.isFinite(value) ? value : null;
const str = (value: unknown): string | null => (typeof value === 'string' && value !== '' ? value : null);

function candidateInfo(id: string, stat: RawStat | undefined): IceCandidateInfo {
  const rawType = str(stat?.candidateType);
  const type =
    rawType === 'host' || rawType === 'srflx' || rawType === 'prflx' || rawType === 'relay'
      ? rawType
      : 'unknown';
  const rawProtocol = str(stat?.protocol)?.toLowerCase();
  return {
    id,
    type,
    protocol: rawProtocol === 'udp' || rawProtocol === 'tcp' ? rawProtocol : 'unknown',
    address: str(stat?.address) ?? str(stat?.ip),
    port: num(stat?.port),
    networkType: str(stat?.networkType),
  };
}

/** Maps RTCPeerConnection.connectionState (or iceConnectionState) to the contract's MediaConnectionState. */
export function mapConnectionState(state: string): MediaConnectionState {
  switch (state) {
    case 'connecting':
    case 'checking':
      return 'checking';
    case 'connected':
    case 'completed':
      return 'connected';
    case 'disconnected':
    case 'failed':
    case 'closed':
      return state;
    default:
      return 'new';
  }
}

/**
 * Turns a Chromium `RTCStatsReport` into the contract's MediaStats: cumulative counters (the diagnostics sampler
 * derives rates), selected candidate pair, every gathered candidate, rtt, jitter, loss and audio levels.
 */
export function mapStatsReport(
  report: StatsReportLike,
  connectionState: MediaConnectionState,
  timestamp: number,
): MediaStats {
  const byId = new Map<string, RawStat>();
  report.forEach((value, key) => {
    if (typeof value === 'object' && value !== null) byId.set(key, value as RawStat);
  });
  const ofType = (type: string, predicate: (stat: RawStat) => boolean = () => true): RawStat[] =>
    [...byId.values()].filter((stat) => stat.type === type && predicate(stat));
  const isAudio = (stat: RawStat) => (stat.kind ?? stat.mediaType) === 'audio';

  // Selected candidate pair: Chromium names it on the transport; Firefox flags the pair itself.
  const transport = ofType('transport').find((stat) => typeof stat.selectedCandidatePairId === 'string');
  const selectedStat =
    (transport ? byId.get(transport.selectedCandidatePairId as string) : undefined) ??
    ofType('candidate-pair').find(
      (pair) => (pair.selected === true || pair.nominated === true) && pair.state === 'succeeded',
    ) ??
    ofType('candidate-pair').find((pair) => pair.state === 'succeeded');

  let selectedPair: SelectedCandidatePair | null = null;
  if (selectedStat) {
    const localId = str(selectedStat.localCandidateId) ?? '';
    const remoteId = str(selectedStat.remoteCandidateId) ?? '';
    const roundTrip = num(selectedStat.currentRoundTripTime);
    selectedPair = {
      local: candidateInfo(localId, byId.get(localId)),
      remote: candidateInfo(remoteId, byId.get(remoteId)),
      state: str(selectedStat.state) ?? 'unknown',
      rttMs: roundTrip === null ? null : roundTrip * 1000,
    };
  }

  const outbound = ofType('outbound-rtp', isAudio);
  const inbound = ofType('inbound-rtp', isAudio);
  const remoteInbound = ofType('remote-inbound-rtp', isAudio);
  const sum = (stats: RawStat[], field: string) =>
    stats.reduce((total, stat) => total + (num(stat[field]) ?? 0), 0);
  const first = (stats: RawStat[], field: string): number | null => {
    for (const stat of stats) {
      const value = num(stat[field]);
      if (value !== null) return value;
    }
    return null;
  };

  const rttSeconds =
    selectedPair !== null && selectedPair.rttMs !== null
      ? selectedPair.rttMs / 1000
      : first(remoteInbound, 'roundTripTime');
  const jitterSeconds = first(inbound, 'jitter') ?? first(remoteInbound, 'jitter');

  const codecId = str(inbound[0]?.codecId) ?? str(outbound[0]?.codecId);
  const codecStat = codecId ? byId.get(codecId) : undefined;
  let codec: string | null = null;
  const mime = str(codecStat?.mimeType);
  if (mime) {
    const name = (mime.split('/')[1] ?? mime).toLowerCase();
    const clockRate = num(codecStat?.clockRate);
    const channels = num(codecStat?.channels);
    codec = [name, clockRate, channels].filter((part) => part !== null).join('/');
  }

  return {
    timestamp,
    connectionState,
    selectedPair,
    localCandidates: ofType('local-candidate').map((stat) => candidateInfo(str(stat.id) ?? '', stat)),
    remoteCandidates: ofType('remote-candidate').map((stat) => candidateInfo(str(stat.id) ?? '', stat)),
    rttMs: rttSeconds === null ? null : rttSeconds * 1000,
    jitterMs: jitterSeconds === null ? null : jitterSeconds * 1000,
    packetsSent: sum(outbound, 'packetsSent'),
    packetsReceived: sum(inbound, 'packetsReceived'),
    packetsLost: sum(inbound, 'packetsLost'),
    bytesSent: sum(outbound, 'bytesSent'),
    bytesReceived: sum(inbound, 'bytesReceived'),
    inputLevel: first(ofType('media-source', isAudio), 'audioLevel'),
    outputLevel: first(inbound, 'audioLevel'),
    codec,
  };
}
