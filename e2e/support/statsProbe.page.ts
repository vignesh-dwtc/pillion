/**
 * Runs INSIDE the app page (bundled by e2e/support/pageBundle.ts and injected with addInitScript, before the app
 * loads). It keeps every RTCPeerConnection the app creates and reads them through the web MediaEngine's own stats
 * mapping (`mapStatsReport` from `src/platform/media/webMediaHelpers.web.ts`, the function
 * `createMediaEngine.web.ts#getStats()` returns), plus the raw `RTCPeerConnection.getStats()` byte counters as an
 * independent cross-check. No app code is changed and nothing here reaches any bundle. Test tooling only.
 */
import type { MediaStats } from '../../src/platform/media/MediaEngine';
import { mapConnectionState, mapStatsReport } from '../../src/platform/media/webMediaHelpers.web';

export interface ProbeSample {
  /** Peer connections the page created / that are still open. */
  created: number;
  open: number;
  /** From the web MediaEngine's mapping of the newest open connection. */
  engine: Pick<
    MediaStats,
    'connectionState' | 'bytesSent' | 'bytesReceived' | 'packetsSent' | 'packetsReceived' | 'codec'
  > & { selectedPair: string | null; iceServers: number };
  /**
   * Raw outbound/inbound audio RTP bytes of the same connection, summed straight from getStats(), plus the cumulative
   * energy of the audio received from the partner (rises only while the partner sends sound, not silence).
   */
  raw: { bytesSent: number; bytesReceived: number; totalAudioEnergy: number };
}

const connections: RTCPeerConnection[] = [];
const Original = window.RTCPeerConnection;
window.RTCPeerConnection = class extends Original {
  constructor(...args: ConstructorParameters<typeof RTCPeerConnection>) {
    super(...args);
    connections.push(this);
  }
} as typeof RTCPeerConnection;

async function sample(): Promise<ProbeSample | null> {
  const open = connections.filter((pc) => pc.connectionState !== 'closed');
  const pc = open[open.length - 1];
  if (pc === undefined) return null;
  const report = await pc.getStats();
  const stats = mapStatsReport(report, mapConnectionState(pc.connectionState), Date.now());
  const raw = { bytesSent: 0, bytesReceived: 0, totalAudioEnergy: 0 };
  report.forEach((stat: Record<string, unknown>) => {
    if ((stat.kind ?? stat.mediaType) !== 'audio') return;
    const n = typeof stat.bytesSent === 'number' ? stat.bytesSent : 0;
    const m = typeof stat.bytesReceived === 'number' ? stat.bytesReceived : 0;
    if (stat.type === 'outbound-rtp') raw.bytesSent += n;
    if (stat.type === 'inbound-rtp') {
      raw.bytesReceived += m;
      if (typeof stat.totalAudioEnergy === 'number') raw.totalAudioEnergy += stat.totalAudioEnergy;
    }
  });
  const pair = stats.selectedPair;
  return {
    created: connections.length,
    open: open.length,
    engine: {
      connectionState: stats.connectionState,
      bytesSent: stats.bytesSent,
      bytesReceived: stats.bytesReceived,
      packetsSent: stats.packetsSent,
      packetsReceived: stats.packetsReceived,
      codec: stats.codec,
      selectedPair: pair
        ? `${pair.local.type}/${pair.local.protocol} -> ${pair.remote.type}/${pair.remote.protocol}`
        : null,
      iceServers: pc.getConfiguration().iceServers?.length ?? 0,
    },
    raw,
  };
}

/** Records every text the ride state label shows, so a short "Reconnecting" between two polls is not missed. */
const rideStates: string[] = [];
function watchRideState(): void {
  let last: string | null = null;
  const read = () => {
    const text = document.querySelector('[data-testid="ride-state"]')?.textContent ?? null;
    if (text !== null && text !== last) {
      last = text;
      rideStates.push(text);
    }
  };
  new MutationObserver(read).observe(document, { subtree: true, childList: true, characterData: true });
}
// The document node exists even before the HTML is parsed, so the observer can start right away.
watchRideState();

const probe = { sample, rideStates: () => [...rideStates] };
export type StatsProbe = typeof probe;
(window as unknown as { __probe: StatsProbe }).__probe = probe;
