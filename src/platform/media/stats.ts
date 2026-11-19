/**
 * Maps a W3C `RTCStatsReport` (Chromium, or the LiveKit fork's Android report, which is a `Map` rebuilt from JSON:
 * node_modules/@livekit/react-native-webrtc/src/RTCPeerConnection.ts `getStats`) to the `MediaStats` contract.
 *
 * Pure and structural: no DOM types, no react-native. Shared by the native engine and the web twin. Tolerant by
 * design: every field may be missing (Android and Chromium differ, and Chromium reports '' addresses), absent
 * counters become 0 and absent gauges null. Seconds become milliseconds. Never throws on garbage entries.
 *
 * Source of every output field:
 *   packets/bytes sent      outbound-rtp (audio), summed
 *   packets/bytes received  inbound-rtp (audio), summed; packetsLost clamped to >= 0
 *   jitterMs                inbound-rtp jitter (what we hear), else remote-inbound-rtp jitter
 *   rttMs                   remote-inbound-rtp roundTripTime, else selected pair currentRoundTripTime
 *   inputLevel              media-source (audio) audioLevel; outputLevel: inbound-rtp audioLevel
 *   selectedPair            transport.selectedCandidatePairId, else a pair flagged `selected`, else the best
 *                           nominated/succeeded pair
 *   local/remoteCandidates  local-candidate / remote-candidate entries
 *   codec                   codec of the inbound (else outbound) stream, formatted 'opus/48000/2'
 */
import type {
  IceCandidateInfo,
  MediaConnectionState,
  MediaStats,
  SelectedCandidatePair,
} from './MediaEngine';

export type RawStat = Readonly<Record<string, unknown>>;

/** A `Map`, an array of stats objects, or an array of `[id, stats]` pairs (a serialised Map). */
export type StatsEntries =
  { forEach(callback: (value: unknown, key: unknown) => void): void } | ArrayLike<unknown>;

function isRecord(value: unknown): value is RawStat {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function num(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function str(value: unknown): string | null {
  return typeof value === 'string' && value !== '' ? value : null;
}

const seconds = (value: unknown): number | null => {
  const v = num(value);
  return v === null ? null : v * 1000;
};

function normalise(entries: StatsEntries): RawStat[] {
  const out: RawStat[] = [];
  const add = (value: unknown, key?: unknown) => {
    if (isRecord(value)) {
      out.push(typeof key === 'string' && value.id === undefined ? { ...value, id: key } : value);
    } else if (Array.isArray(value) && value.length === 2 && isRecord(value[1])) {
      add(value[1], value[0]); // [id, stats] pair
    }
  };
  try {
    if (entries === null || entries === undefined) return out;
    if ('forEach' in entries && typeof entries.forEach === 'function' && !Array.isArray(entries)) {
      (entries as { forEach(cb: (v: unknown, k: unknown) => void): void }).forEach((v, k) => add(v, k));
    } else {
      const list = entries as ArrayLike<unknown>;
      for (let i = 0; i < list.length; i++) add(list[i]);
    }
  } catch {
    // a malformed report yields whatever was collected so far
  }
  return out;
}

const isAudio = (stat: RawStat): boolean => {
  const kind = str(stat.kind) ?? str(stat.mediaType);
  return kind === null || kind === 'audio';
};

function sum(stats: RawStat[], key: string): number {
  let total = 0;
  for (const stat of stats) total += num(stat[key]) ?? 0;
  return total;
}

function firstNumber(stats: RawStat[], read: (stat: RawStat) => number | null): number | null {
  for (const stat of stats) {
    const value = read(stat);
    if (value !== null) return value;
  }
  return null;
}

function clamp01(value: number | null): number | null {
  return value === null ? null : Math.min(1, Math.max(0, value));
}

export function candidateInfo(stat: RawStat): IceCandidateInfo {
  const rawType = str(stat.candidateType);
  const type =
    rawType === 'host' || rawType === 'srflx' || rawType === 'prflx' || rawType === 'relay'
      ? rawType
      : 'unknown';
  const rawProtocol = str(stat.protocol)?.toLowerCase();
  return {
    id: str(stat.id) ?? '',
    type,
    protocol: rawProtocol === 'udp' || rawProtocol === 'tcp' ? rawProtocol : 'unknown',
    address: str(stat.address) ?? str(stat.ip),
    port: num(stat.port),
    networkType: str(stat.networkType),
  };
}

function pickSelectedPair(stats: RawStat[], byId: Map<string, RawStat>): RawStat | null {
  const pairs = stats.filter((s) => s.type === 'candidate-pair');
  for (const transport of stats.filter((s) => s.type === 'transport')) {
    const id = str(transport.selectedCandidatePairId);
    const pair = id === null ? undefined : byId.get(id);
    if (pair && pair.type === 'candidate-pair') return pair;
  }
  const flagged = pairs.find((p) => p.selected === true);
  if (flagged) return flagged;
  const usable = pairs.filter(
    (p) => p.state === 'succeeded' && (p.nominated === true || p.writable === true),
  );
  if (usable.length === 0) return null;
  // Prefer the pair that actually carried the most traffic.
  return usable.reduce((best, p) =>
    (num(p.bytesReceived) ?? 0) + (num(p.bytesSent) ?? 0) >
    (num(best.bytesReceived) ?? 0) + (num(best.bytesSent) ?? 0)
      ? p
      : best,
  );
}

function formatCodec(stat: RawStat | undefined): string | null {
  if (!stat) return null;
  const mime = str(stat.mimeType);
  if (mime === null) return null;
  const name = mime.replace(/^audio\//i, '').toLowerCase();
  const rate = num(stat.clockRate);
  const channels = num(stat.channels);
  return [name, rate, channels].filter((part) => part !== null).join('/');
}

export function mapStatsReport(
  entries: StatsEntries,
  now: number,
  connectionState: MediaConnectionState,
): MediaStats {
  const stats = normalise(entries);
  const byId = new Map<string, RawStat>();
  for (const stat of stats) {
    const id = str(stat.id);
    if (id !== null) byId.set(id, stat);
  }
  const ofType = (type: string, audioOnly = true) =>
    stats.filter((s) => s.type === type && (!audioOnly || isAudio(s)));

  const inbound = ofType('inbound-rtp');
  const outbound = ofType('outbound-rtp');
  const remoteInbound = ofType('remote-inbound-rtp');
  const sources = ofType('media-source');

  const pairStat = pickSelectedPair(stats, byId);
  let selectedPair: SelectedCandidatePair | null = null;
  if (pairStat) {
    const local = byId.get(str(pairStat.localCandidateId) ?? '');
    const remote = byId.get(str(pairStat.remoteCandidateId) ?? '');
    const missing = (id: unknown): IceCandidateInfo => candidateInfo({ id: str(id) ?? '' });
    selectedPair = {
      local: local ? candidateInfo(local) : missing(pairStat.localCandidateId),
      remote: remote ? candidateInfo(remote) : missing(pairStat.remoteCandidateId),
      state: str(pairStat.state) ?? 'unknown',
      rttMs: seconds(pairStat.currentRoundTripTime),
    };
  }

  const jitterMs =
    firstNumber(inbound, (s) => seconds(s.jitter)) ?? firstNumber(remoteInbound, (s) => seconds(s.jitter));
  const rttMs = firstNumber(remoteInbound, (s) => seconds(s.roundTripTime)) ?? selectedPair?.rttMs ?? null;

  const codecStat = (rtp: RawStat[]): RawStat | undefined => {
    for (const stat of rtp) {
      const codec = byId.get(str(stat.codecId) ?? '');
      if (codec) return codec;
    }
    return undefined;
  };
  const codec =
    formatCodec(codecStat(inbound)) ??
    formatCodec(codecStat(outbound)) ??
    formatCodec(
      ofType('codec').find((c) => {
        const mime = str(c.mimeType)?.toLowerCase() ?? '';
        return mime.startsWith('audio/') && !/red|telephone-event|cn$/.test(mime);
      }),
    );

  return {
    timestamp: now,
    connectionState,
    selectedPair,
    localCandidates: ofType('local-candidate', false).map(candidateInfo),
    remoteCandidates: ofType('remote-candidate', false).map(candidateInfo),
    rttMs,
    jitterMs,
    packetsSent: sum(outbound, 'packetsSent'),
    packetsReceived: sum(inbound, 'packetsReceived'),
    packetsLost: Math.max(0, sum(inbound, 'packetsLost')),
    bytesSent: sum(outbound, 'bytesSent'),
    bytesReceived: sum(inbound, 'bytesReceived'),
    inputLevel: clamp01(firstNumber(sources, (s) => num(s.audioLevel))),
    outputLevel: clamp01(firstNumber(inbound, (s) => num(s.audioLevel))),
    codec,
  };
}
