/**
 * Runs INSIDE a browser page (bundled by e2e/support/pageBundle.ts): a minimal "peer" built from the real web twins,
 * `createLinkTransport()` (WebLinkTransport over the dev relay) and `createMediaEngine()` (browser WebRTC). It plays
 * host or guest with a throwaway JSON signaling protocol (no pairing secret, no secure channel: that is core's job and
 * is exercised by the full two-peer test once the session exists).
 *
 * It exists so the twins are proven in real Chromium, with the fake microphone and the relay, before and independently
 * of the app UI: real offer/answer/ICE, audio bytes both ways, mute, dropped link and renegotiation.
 * Test tooling only: nothing imports this file except e2e/twins.spec.ts.
 */
import { DEFAULT_AUDIO_TUNABLES } from '../../src/platform/audio/AudioTunables';
import { createLinkTransport } from '../../src/platform/link/createLinkTransport.web';
import { LinkError, type LinkChannel, type LinkRole } from '../../src/platform/link/LinkTransport';
import { createMediaEngine } from '../../src/platform/media/createMediaEngine.web';
import type {
  IceCandidateInit,
  MediaConnectionState,
  MediaSession,
} from '../../src/platform/media/MediaEngine';

type Signal =
  { t: 'sdp'; kind: 'offer' | 'answer'; sdp: string } | { t: 'ice'; candidate: IceCandidateInit | null };

export interface RawAudioStats {
  bytesSent: number;
  packetsSent: number;
  bytesReceived: number;
  packetsReceived: number;
  /** Cumulative energy of the audio received from the partner (rises only while the partner sends sound). */
  totalAudioEnergy: number;
  /** Cumulative energy of the audio this page captured (the media source, before muting). */
  sourceEnergy: number;
  peerConnections: number;
  closedPeerConnections: number;
}

export interface PeerSnapshot {
  state: MediaConnectionState;
  /** From the web MediaEngine's own getStats() mapping. */
  engine: {
    bytesSent: number;
    bytesReceived: number;
    packetsSent: number;
    packetsReceived: number;
    codec: string | null;
    selectedPairTypes: string | null;
    localCandidateTypes: string[];
    remoteCandidateTypes: string[];
    iceServersConfigured: number;
  };
  /** Straight from RTCPeerConnection.getStats(), independent of the twin's mapping. */
  raw: RawAudioStats;
  remoteAudio: { elements: number; playing: boolean; liveTracks: number };
  localOpusFmtp: string | null;
  localPtime: string | null;
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
const encoder = new TextEncoder();
const decoder = new TextDecoder();

const trackedConnections = () => (window as unknown as { __pcs?: RTCPeerConnection[] }).__pcs ?? [];

const link = createLinkTransport();
const media = createMediaEngine();
const events: string[] = [];

const heldChannels: LinkChannel[] = [];
let channel: LinkChannel | null = null;
let session: MediaSession | null = null;
let sessionState: MediaConnectionState = 'new';
let mediaStarted = false;
let role: LinkRole = 'host';
let closeWaiters: ((reason: string) => void)[] = [];
let lastClose: string | null = null;

function note(message: string) {
  events.push(`${new Date().toISOString().slice(11, 23)} ${message}`);
}

async function send(signal: Signal): Promise<void> {
  if (channel === null) throw new Error('no link');
  await channel.send(encoder.encode(JSON.stringify(signal)));
}

async function onSignal(data: Uint8Array): Promise<void> {
  const signal = JSON.parse(decoder.decode(data)) as Signal;
  if (session === null) {
    note(`signal ${signal.t} dropped: no session`);
    return;
  }
  try {
    if (signal.t === 'sdp' && signal.kind === 'offer') {
      note('offer received');
      const answer = await session.acceptOffer({ type: 'offer', sdp: signal.sdp });
      await send({ t: 'sdp', kind: 'answer', sdp: answer.sdp });
      note('answer sent');
    } else if (signal.t === 'sdp') {
      note('answer received');
      await session.acceptAnswer({ type: 'answer', sdp: signal.sdp });
    } else {
      await session.addRemoteCandidate(signal.candidate);
    }
  } catch (error) {
    note(`signal error: ${error instanceof Error ? error.message : String(error)}`);
  }
}

async function startMedia(muted = false): Promise<void> {
  if (mediaStarted) return;
  await media.start({ tunables: DEFAULT_AUDIO_TUNABLES, startMuted: muted });
  mediaStarted = true;
  note('microphone started');
}

async function openLink(linkRole: LinkRole, pairId: string, timeoutMs = 20_000): Promise<void> {
  role = linkRole;
  lastClose = null;
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    try {
      channel = await link.open({ role, pairId, timeoutMs: 5_000 });
      break;
    } catch (error) {
      const code = error instanceof LinkError ? error.code : 'unknown';
      note(`link open failed: ${code}`);
      if (Date.now() > deadline || code === 'unsupported' || code === 'aborted') throw error;
      await sleep(200); // what the session layer does with its backoff
    }
  }
  note(`link up as ${role}`);
  const current = channel;
  current.onData((data) => void onSignal(data));
  current.onClose((reason) => {
    note(`link closed: ${reason}`);
    lastClose = reason;
    const waiters = closeWaiters;
    closeWaiters = [];
    for (const waiter of waiters) waiter(reason);
  });
  await startMedia();
  session = await media.createSession();
  sessionState = 'new';
  session.onState((state) => {
    sessionState = state;
    note(`media ${state}`);
  });
  session.onLocalCandidate((candidate) => {
    send({ t: 'ice', candidate }).catch(() => undefined); // the link may be gone already
  });
}

/** One bare open() attempt, no retry and no media: reports 'opened' or the LinkError code (refusal tests). */
async function openOnce(linkRole: LinkRole, pairId: string, timeoutMs: number): Promise<string> {
  try {
    const opened = await link.open({ role: linkRole, pairId, timeoutMs });
    heldChannels.push(opened);
    return 'opened';
  } catch (error) {
    return error instanceof LinkError ? error.code : String(error);
  }
}

async function offer(): Promise<void> {
  if (session === null) throw new Error('no session');
  const description = await session.createOffer();
  await send({ t: 'sdp', kind: 'offer', sdp: description.sdp });
  note('offer sent');
}

async function waitFor(predicate: () => boolean, what: string, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}\n${events.join('\n')}`);
    await sleep(50);
  }
}

async function rawAudioStats(): Promise<RawAudioStats> {
  const totals: RawAudioStats = {
    bytesSent: 0,
    packetsSent: 0,
    bytesReceived: 0,
    packetsReceived: 0,
    totalAudioEnergy: 0,
    sourceEnergy: 0,
    peerConnections: 0,
    closedPeerConnections: 0,
  };
  for (const pc of trackedConnections()) {
    totals.peerConnections += 1;
    if (pc.connectionState === 'closed') {
      totals.closedPeerConnections += 1;
      continue;
    }
    const report = await pc.getStats();
    report.forEach((stat: Record<string, unknown>) => {
      const audio = (stat.kind ?? stat.mediaType) === 'audio';
      if (!audio) return;
      const n = (value: unknown) => (typeof value === 'number' ? value : 0);
      if (stat.type === 'outbound-rtp') {
        totals.bytesSent += n(stat.bytesSent);
        totals.packetsSent += n(stat.packetsSent);
      } else if (stat.type === 'inbound-rtp') {
        totals.bytesReceived += n(stat.bytesReceived);
        totals.packetsReceived += n(stat.packetsReceived);
        totals.totalAudioEnergy += n(stat.totalAudioEnergy);
      } else if (stat.type === 'media-source') {
        totals.sourceEnergy += n(stat.totalAudioEnergy);
      }
    });
  }
  return totals;
}

async function snapshot(): Promise<PeerSnapshot> {
  if (session === null) throw new Error('no session');
  const stats = await session.getStats();
  const live = trackedConnections().filter((pc) => pc.connectionState !== 'closed');
  const pc = live[live.length - 1];
  const localSdp = pc?.localDescription?.sdp ?? '';
  const remoteAudio = [...document.querySelectorAll<HTMLAudioElement>('audio[data-testid="remote-audio"]')];
  const pair = stats.selectedPair;
  return {
    state: stats.connectionState,
    engine: {
      bytesSent: stats.bytesSent,
      bytesReceived: stats.bytesReceived,
      packetsSent: stats.packetsSent,
      packetsReceived: stats.packetsReceived,
      codec: stats.codec,
      selectedPairTypes: pair
        ? `${pair.local.type}/${pair.local.protocol} -> ${pair.remote.type}/${pair.remote.protocol}`
        : null,
      localCandidateTypes: [...new Set(stats.localCandidates.map((candidate) => candidate.type))],
      remoteCandidateTypes: [...new Set(stats.remoteCandidates.map((candidate) => candidate.type))],
      iceServersConfigured: pc?.getConfiguration().iceServers?.length ?? -1,
    },
    raw: await rawAudioStats(),
    remoteAudio: {
      elements: remoteAudio.length,
      playing: remoteAudio.some((element) => !element.paused && element.readyState >= 2),
      liveTracks: remoteAudio.reduce(
        (count, element) =>
          count +
          ((element.srcObject as MediaStream | null)
            ?.getAudioTracks()
            .filter((track) => track.readyState === 'live').length ?? 0),
        0,
      ),
    },
    localOpusFmtp: /^a=fmtp:\d+ .*useinbandfec.*$/m.exec(localSdp)?.[0] ?? null,
    localPtime: /^a=ptime:\d+$/m.exec(localSdp)?.[0] ?? null,
  };
}

async function closeSession(): Promise<void> {
  const closing = session;
  session = null;
  sessionState = 'new';
  await closing?.close();
}

const peer = {
  openLink,
  openOnce,
  offer,
  setMuted: (muted: boolean) => media.setMuted(muted),
  snapshot,
  closeSession,
  waitForConnected: (timeoutMs = 20_000) =>
    waitFor(() => sessionState === 'connected', 'media to connect', timeoutMs),
  waitForLinkClose: (timeoutMs = 10_000): Promise<string> =>
    lastClose !== null
      ? Promise.resolve(lastClose)
      : new Promise((resolve, reject) => {
          const timer = setTimeout(
            () => reject(new Error(`link did not close\n${events.join('\n')}`)),
            timeoutMs,
          );
          closeWaiters.push((reason) => {
            clearTimeout(timer);
            resolve(reason);
          });
        }),
  linkUp: () => channel !== null && lastClose === null,
  events: () => [...events],
  async shutdown() {
    await Promise.all(heldChannels.splice(0).map((held) => held.close()));
    await closeSession();
    await media.stop();
    await link.dispose();
    mediaStarted = false;
    channel = null;
  },
};

export type PeerDriver = typeof peer;
(window as unknown as { __peer: PeerDriver }).__peer = peer;
