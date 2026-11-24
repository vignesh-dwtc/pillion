/**
 * In-memory stand-in for `@livekit/react-native-webrtc`, for Jest only (`jest.mock(...)` in the media tests).
 * It mirrors the shape of the package's JS classes that the native engine uses (checked against
 * node_modules/@livekit/react-native-webrtc/src): getUserMedia -> MediaStream with `release()`, RTCPeerConnection with
 * addEventListener / createOffer / setLocalDescription / addIceCandidate / getStats (a Map) / close, RTCRtpSender with
 * getParameters / setParameters / replaceTrack, remote MediaStreamTrack `_setVolume`.
 *
 * Behaviour knobs live on `fakeWebRtc` (reset with `resetFakeWebRtc()`): fixture SDPs, getUserMedia failure, an
 * auto-connect mode where two fake peer connections that exchanged descriptions and candidates report `connected`,
 * and synthetic stats.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const fixture = (name: string) => readFileSync(join(__dirname, '..', '__fixtures__', name), 'utf8');

let nextId = 1;

export class FakeTrack {
  readonly id = `track-${nextId++}`;
  readonly kind = 'audio';
  enabled = true;
  released = false;
  volume: number | null = null;
  constructor(readonly remote: boolean) {}
  release(): void {
    this.released = true;
  }
  stop(): void {
    this.enabled = false;
  }
  _setVolume(volume: number): void {
    this.volume = volume;
  }
}

export class FakeStream {
  readonly id = `stream-${nextId++}`;
  released = false;
  constructor(
    readonly tracks: FakeTrack[],
    readonly constraints: unknown,
  ) {}
  getAudioTracks(): FakeTrack[] {
    return this.tracks.filter((t) => t.kind === 'audio');
  }
  getTracks(): FakeTrack[] {
    return [...this.tracks];
  }
  release(releaseTracks = true): void {
    this.released = true;
    if (releaseTracks) for (const t of this.tracks) t.release();
  }
}

export class FakeSender {
  setParametersCalls: { encodings: { maxBitrate?: number | null }[] }[] = [];
  replaceTrackCalls: FakeTrack[] = [];
  private params = { transactionId: 't', encodings: [{ active: true, maxBitrate: null as number | null }] };
  constructor(public track: FakeTrack | null) {}
  getParameters() {
    return this.params;
  }
  async setParameters(parameters: { encodings: { maxBitrate?: number | null }[] }): Promise<void> {
    const copy = JSON.parse(JSON.stringify(parameters)) as typeof this.params;
    this.setParametersCalls.push(copy);
    this.params = copy;
  }
  async replaceTrack(track: FakeTrack): Promise<void> {
    this.replaceTrackCalls.push(track);
    this.track = track;
  }
}

type Listener = (event: Record<string, unknown>) => void;

export interface Description {
  type: string;
  sdp: string;
}

export class FakePeerConnection {
  readonly id = nextId++;
  connectionState = 'new';
  localDescription: Description | null = null;
  remoteDescription: Description | null = null;
  closed = false;
  readonly senders: FakeSender[] = [];
  readonly transceivers: { direction: string; sender: FakeSender | null }[] = [];
  readonly addedCandidates: unknown[] = [];
  readonly setLocalCalls: Description[] = [];
  readonly offerOptions: unknown[] = [];
  private readonly listeners = new Map<string, Set<Listener>>();
  /** Remote track created when the remote description arrives (what the package dispatches as `track`). */
  remoteTrack: FakeTrack | null = null;

  constructor(readonly config: unknown) {
    if (fakeWebRtc.failPeerConnectionInit) {
      throw new Error('Failed to initialize PeerConnection, check the native logs!');
    }
    fakeWebRtc.peerConnections.push(this);
  }

  addEventListener(type: string, listener: Listener): void {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set());
    this.listeners.get(type)?.add(listener);
  }

  removeEventListener(type: string, listener: Listener): void {
    this.listeners.get(type)?.delete(listener);
  }

  emit(type: string, event: Record<string, unknown> = {}): void {
    for (const listener of [...(this.listeners.get(type) ?? [])]) listener(event);
  }

  setConnectionState(state: string): void {
    this.connectionState = state;
    this.emit('connectionstatechange');
  }

  emitCandidate(
    candidate: { candidate: string; sdpMid?: string | null; sdpMLineIndex?: number | null } | null,
  ) {
    this.emit('icecandidate', { candidate });
  }

  addTrack(track: FakeTrack, ..._streams: FakeStream[]): FakeSender {
    if (this.closed) throw new Error('Peer Connection is closed');
    const sender = new FakeSender(track);
    this.senders.push(sender);
    this.transceivers.push({ direction: 'sendrecv', sender });
    return sender;
  }

  addTransceiver(kind: string, init: { direction: string }) {
    const t = { direction: `${kind}:${init.direction}`, sender: null };
    this.transceivers.push(t);
    return t;
  }

  getTransceivers() {
    return [...this.transceivers];
  }

  async createOffer(options?: unknown): Promise<Description> {
    this.offerOptions.push(options);
    if (fakeWebRtc.failCreateOffer) throw new Error('createOffer exploded');
    const recvOnly = this.senders.length === 0;
    return { type: 'offer', sdp: recvOnly ? fakeWebRtc.recvOnlyOfferSdp : fakeWebRtc.offerSdp };
  }

  async createAnswer(): Promise<Description> {
    return { type: 'answer', sdp: fakeWebRtc.answerSdp };
  }

  async setLocalDescription(description: Description): Promise<void> {
    if (this.closed) throw new Error('closed');
    this.setLocalCalls.push(description);
    this.localDescription = { ...description };
    if (fakeWebRtc.autoGather) {
      queueMicrotask(() => {
        if (this.closed) return;
        this.emitCandidate({
          candidate: `candidate:1 1 udp 2122260223 192.0.2.${this.id % 250} 5${this.id} typ host`,
          sdpMid: '0',
          sdpMLineIndex: 0,
        });
        this.emitCandidate(null);
      });
    }
    this.maybeConnect();
  }

  async setRemoteDescription(description: Description): Promise<void> {
    if (this.closed) throw new Error('closed');
    if (fakeWebRtc.failSetRemote) throw new Error('SessionDescription is NULL.');
    this.remoteDescription = { ...description };
    if (description.sdp.includes('a=sendrecv') || description.sdp.includes('a=sendonly')) {
      this.remoteTrack = new FakeTrack(true);
      this.emit('track', { track: this.remoteTrack, streams: [] });
    }
    this.maybeConnect();
  }

  async addIceCandidate(candidate: unknown): Promise<void> {
    if (this.closed) throw new Error('Peer Connection is closed');
    if (this.remoteDescription === null) throw new Error('no remote description');
    this.addedCandidates.push(candidate);
    this.maybeConnect();
  }

  async getStats(): Promise<Map<string, Record<string, unknown>>> {
    if (fakeWebRtc.statsFor) return fakeWebRtc.statsFor(this);
    const entries: [string, Record<string, unknown>][] = [];
    if (this.senders.length > 0 && this.connectionState === 'connected') {
      entries.push([
        'OT',
        { id: 'OT', type: 'outbound-rtp', kind: 'audio', bytesSent: 1000, packetsSent: 50 },
      ]);
    }
    if (this.remoteTrack !== null && this.connectionState === 'connected') {
      entries.push([
        'IT',
        {
          id: 'IT',
          type: 'inbound-rtp',
          kind: 'audio',
          bytesReceived: 900,
          packetsReceived: 45,
          packetsLost: 1,
        },
      ]);
    }
    return new Map(entries);
  }

  close(): void {
    this.closed = true;
    this.connectionState = 'closed';
  }

  private maybeConnect(): void {
    if (!fakeWebRtc.autoConnect || this.closed) return;
    if (this.localDescription && this.remoteDescription && this.addedCandidates.length > 0) {
      if (this.connectionState === 'new') {
        queueMicrotask(() => {
          if (this.closed) return;
          this.setConnectionState('connecting');
          this.setConnectionState('connected');
        });
      }
    }
  }
}

export const fakeWebRtc = {
  peerConnections: [] as FakePeerConnection[],
  streams: [] as FakeStream[],
  offerSdp: fixture('offer.chromium.sdp'),
  recvOnlyOfferSdp: fixture('offer-recvonly.chromium.sdp'),
  answerSdp: fixture('answer.chromium.sdp'),
  /** getUserMedia rejects with this value (any shape) when set. */
  getUserMediaError: null as unknown,
  getUserMediaNoTrack: false,
  failPeerConnectionInit: false,
  failCreateOffer: false,
  failSetRemote: false,
  autoGather: false,
  autoConnect: false,
  statsFor: null as ((pc: FakePeerConnection) => Map<string, Record<string, unknown>>) | null,
};

export function resetFakeWebRtc(): void {
  fakeWebRtc.peerConnections = [];
  fakeWebRtc.streams = [];
  fakeWebRtc.getUserMediaError = null;
  fakeWebRtc.getUserMediaNoTrack = false;
  fakeWebRtc.failPeerConnectionInit = false;
  fakeWebRtc.failCreateOffer = false;
  fakeWebRtc.failSetRemote = false;
  fakeWebRtc.autoGather = false;
  fakeWebRtc.autoConnect = false;
  fakeWebRtc.statsFor = null;
}

export const mediaDevices = {
  async getUserMedia(constraints: { audio?: unknown }): Promise<FakeStream> {
    if (fakeWebRtc.getUserMediaError !== null) throw fakeWebRtc.getUserMediaError;
    const stream = new FakeStream(fakeWebRtc.getUserMediaNoTrack ? [] : [new FakeTrack(false)], constraints);
    fakeWebRtc.streams.push(stream);
    return stream;
  },
};

export { FakePeerConnection as RTCPeerConnection };
