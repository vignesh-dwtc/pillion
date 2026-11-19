import type { AudioTunables } from '../../../platform/audio/AudioTunables';
import {
  MediaError,
  type IceCandidateInfo,
  type IceCandidateInit,
  type MediaConnectionState,
  type MediaEngine,
  type MediaEngineStartOptions,
  type MediaSession,
  type MediaSessionOptions,
  type MediaStats,
  type SessionDescription,
} from '../../../platform/media/MediaEngine';
import type { Clock, TimerHandle, Unsubscribe } from '../../common/types';
import { FakeNetwork } from './FakeNetwork';

/**
 * Fake `MediaEngine` / `MediaSession` pair that negotiates for real, minus the media itself.
 *
 * A session reaches `connected` only when ALL of this holds, which is what makes the simulation prove something:
 *   - its local description was created and the remote description was applied (an offer travelled one way and
 *     an answer the other, through the signaling link under test),
 *   - at least one remote candidate was added (candidates travelled through the signaling link too),
 *   - the partner's session exists and is open, and the network path is up.
 * The fakes are as strict as a browser: a candidate before the remote description, an answer without an offer, or
 * SDP that does not come from a fake session all reject with MediaError('negotiation-failed').
 *
 * When the path goes down (FakeNetwork) or the partner's session closes, a connected session reports
 * `disconnected` and, if `failAfterMs` is set, `failed` after that long, unless the path returns first: the same
 * shape as ICE consent failure.
 */

export interface FakeMediaOptions {
  clock: Clock;
  network?: FakeNetwork;
  /** Delay between "negotiated" and `connected`. Default 0. */
  connectDelayMs?: number;
  /** `disconnected` turns into `failed` after this long. null never fails by itself. Default 2000. */
  failAfterMs?: number | null;
  /** Local candidates emitted per negotiation. Default 2. */
  candidatesPerSession?: number;
}

const SDP_ID = /a=fake-session:(\S+)/;

export class FakeMediaFabric {
  readonly network: FakeNetwork;
  readonly clock: Clock;
  readonly connectDelayMs: number;
  readonly failAfterMs: number | null;
  readonly candidatesPerSession: number;

  private readonly sessions = new Map<string, FakeMediaSession>();
  private nextSession = 1;

  constructor(options: FakeMediaOptions) {
    this.clock = options.clock;
    this.network = options.network ?? new FakeNetwork();
    this.connectDelayMs = options.connectDelayMs ?? 0;
    this.failAfterMs = options.failAfterMs === undefined ? 2000 : options.failAfterMs;
    this.candidatesPerSession = options.candidatesPerSession ?? 2;
    this.network.onChange(() => {
      for (const session of [...this.sessions.values()]) session.onNetworkChange();
    });
  }

  newSessionId(owner: string): string {
    const id = `${owner}-${this.nextSession}`;
    this.nextSession += 1;
    return id;
  }

  register(session: FakeMediaSession): void {
    this.sessions.set(session.id, session);
  }

  find(id: string): FakeMediaSession | undefined {
    return this.sessions.get(id);
  }

  notifyClosed(id: string): void {
    for (const session of [...this.sessions.values()]) {
      if (session.remoteId === id) session.onPeerClosed();
    }
  }

  get openSessions(): number {
    return [...this.sessions.values()].filter((s) => !s.isClosed).length;
  }

  get pathUp(): boolean {
    return this.network.isUp && !this.network.isBlackholed;
  }
}

function candidateInfo(id: string, address: string, port: number): IceCandidateInfo {
  return { id, type: 'host', protocol: 'udp', address, port, networkType: 'wifi' };
}

export class FakeMediaSession implements MediaSession {
  readonly id: string;
  remoteId: string | null = null;
  readonly remoteCandidates: (IceCandidateInit | null)[] = [];
  readonly localCandidates: (IceCandidateInit | null)[] = [];
  readonly options: MediaSessionOptions;
  closeCalls = 0;

  private currentState: MediaConnectionState = 'new';
  private localDescription: SessionDescription | null = null;
  private remoteDescription: SessionDescription | null = null;
  private closedFlag = false;
  private connectTimer: TimerHandle | null = null;
  private connectPending = false;
  private failTimer: TimerHandle | null = null;
  private connectedMs = 0;
  private connectedSince: number | null = null;
  private statsOverride: Partial<MediaStats> | null = null;
  private readonly candidateListeners = new Set<(candidate: IceCandidateInit | null) => void>();
  private readonly stateListeners = new Set<(state: MediaConnectionState) => void>();

  constructor(
    private readonly fabric: FakeMediaFabric,
    private readonly owner: string,
    options: MediaSessionOptions,
  ) {
    this.id = fabric.newSessionId(owner);
    this.options = options;
    fabric.register(this);
  }

  get state(): MediaConnectionState {
    return this.currentState;
  }

  get isClosed(): boolean {
    return this.closedFlag;
  }

  // ---- MediaSession -----------------------------------------------------------------------------------

  async createOffer(): Promise<SessionDescription> {
    this.assertOpen();
    if (this.remoteDescription) throw this.invalid('createOffer after a remote description');
    const offer: SessionDescription = { type: 'offer', sdp: this.sdp('offer') };
    this.localDescription = offer;
    this.emitCandidatesSoon();
    return offer;
  }

  async acceptOffer(offer: SessionDescription): Promise<SessionDescription> {
    this.assertOpen();
    if (offer.type !== 'offer') throw this.invalid('acceptOffer needs an offer');
    const remote = SDP_ID.exec(offer.sdp)?.[1];
    if (!remote) throw this.invalid('offer is not from a fake session');
    this.remoteId = remote;
    this.remoteDescription = offer;
    const answer: SessionDescription = { type: 'answer', sdp: this.sdp('answer') };
    this.localDescription = answer;
    this.emitCandidatesSoon();
    this.maybeConnect();
    return answer;
  }

  async acceptAnswer(answer: SessionDescription): Promise<void> {
    this.assertOpen();
    if (answer.type !== 'answer') throw this.invalid('acceptAnswer needs an answer');
    if (!this.localDescription || this.localDescription.type !== 'offer') {
      throw this.invalid('acceptAnswer without a local offer');
    }
    const remote = SDP_ID.exec(answer.sdp)?.[1];
    if (!remote) throw this.invalid('answer is not from a fake session');
    this.remoteId = remote;
    this.remoteDescription = answer;
    this.maybeConnect();
  }

  async addRemoteCandidate(candidate: IceCandidateInit | null): Promise<void> {
    this.assertOpen();
    if (!this.remoteDescription) throw this.invalid('candidate before the remote description');
    if (candidate !== null && !candidate.candidate.includes('fake-')) {
      throw this.invalid('candidate is not from a fake session');
    }
    this.remoteCandidates.push(candidate);
    this.maybeConnect();
  }

  onLocalCandidate(listener: (candidate: IceCandidateInit | null) => void): Unsubscribe {
    this.candidateListeners.add(listener);
    return () => {
      this.candidateListeners.delete(listener);
    };
  }

  onState(listener: (state: MediaConnectionState) => void): Unsubscribe {
    this.stateListeners.add(listener);
    return () => {
      this.stateListeners.delete(listener);
    };
  }

  async getStats(): Promise<MediaStats> {
    if (this.closedFlag) throw new MediaError('closed', 'session is closed');
    const now = this.fabric.clock.now();
    const connectedMs = this.connectedMs + (this.connectedSince === null ? 0 : now - this.connectedSince);
    const seconds = connectedMs / 1000;
    const connected = this.currentState === 'connected';
    const local = candidateInfo(`${this.id}-l0`, '10.0.0.1', 5000);
    const remote = candidateInfo(`${this.id}-r0`, '10.0.0.2', 5000);
    const stats: MediaStats = {
      timestamp: now,
      connectionState: this.currentState,
      selectedPair: connected ? { local, remote, state: 'succeeded', rttMs: 12 } : null,
      localCandidates: this.localCandidates.flatMap((c, i) =>
        c ? [candidateInfo(`${this.id}-l${i}`, '10.0.0.1', 5000 + i)] : [],
      ),
      remoteCandidates: this.remoteCandidates.flatMap((c, i) =>
        c ? [candidateInfo(`${this.id}-r${i}`, '10.0.0.2', 5000 + i)] : [],
      ),
      rttMs: connected ? 12 : null,
      jitterMs: connected ? 3 : null,
      // 50 packets/s of 60 byte Opus payloads in each direction while connected.
      packetsSent: Math.floor(seconds * 50),
      packetsReceived: Math.floor(seconds * 50),
      packetsLost: 0,
      bytesSent: Math.floor(seconds * 3000),
      bytesReceived: Math.floor(seconds * 3000),
      inputLevel: connected ? 0.25 : null,
      outputLevel: connected ? 0.2 : null,
      codec: 'opus/48000/2',
      ...this.statsOverride,
    };
    return stats;
  }

  close(): Promise<void> {
    this.closeCalls += 1;
    if (this.closedFlag) return Promise.resolve();
    this.closedFlag = true;
    this.clearTimers();
    this.accumulateConnected();
    this.setState('closed');
    this.stateListeners.clear();
    this.candidateListeners.clear();
    this.fabric.notifyClosed(this.id);
    return Promise.resolve();
  }

  // ---- test controls ----------------------------------------------------------------------------------

  /** Overrides fields of the stats this session reports (counters, levels, rtt) from now on. */
  setStats(override: Partial<MediaStats> | null): void {
    this.statsOverride = override;
  }

  /** Forces a state, as ICE would (for example 'failed' or 'disconnected'). */
  forceState(state: MediaConnectionState): void {
    if (this.closedFlag) return;
    this.setState(state);
  }

  // ---- fabric hooks -----------------------------------------------------------------------------------

  onNetworkChange(): void {
    if (this.closedFlag) return;
    if (this.fabric.pathUp) {
      this.clearFailTimer();
      if (this.currentState === 'disconnected') this.setState('connected');
      else this.maybeConnect();
    } else {
      this.pathLost();
    }
  }

  onPeerClosed(): void {
    if (this.closedFlag) return;
    this.pathLost();
  }

  // ---- internals --------------------------------------------------------------------------------------

  private pathLost(): void {
    this.clearConnectTimer();
    this.connectPending = false;
    if (this.currentState === 'connected') {
      this.setState('disconnected');
      this.armFail();
    } else if (this.currentState === 'checking' || this.currentState === 'new') {
      // Never connected: nothing to lose; the negotiation timeout of the session layer decides.
    }
  }

  private armFail(): void {
    const { failAfterMs, clock } = this.fabric;
    if (failAfterMs === null || this.failTimer !== null) return;
    this.failTimer = clock.setTimeout(() => {
      this.failTimer = null;
      if (this.currentState === 'disconnected') this.setState('failed');
    }, failAfterMs);
  }

  private maybeConnect(): void {
    if (this.closedFlag) return;
    if (this.currentState !== 'new' && this.currentState !== 'checking') return;
    if (!this.localDescription || !this.remoteDescription) return;
    if (this.currentState === 'new') this.setState('checking');
    if (!this.remoteCandidates.some((c) => c !== null)) return;
    if (!this.fabric.pathUp) return;
    const peer = this.remoteId ? this.fabric.find(this.remoteId) : undefined;
    if (!peer || peer.isClosed) return;
    if (this.connectTimer !== null || this.connectPending) return;
    const connect = (): void => {
      this.connectTimer = null;
      this.connectPending = false;
      if (this.closedFlag || this.currentState === 'connected' || !this.fabric.pathUp) return;
      const livePeer = this.remoteId ? this.fabric.find(this.remoteId) : undefined;
      if (livePeer && !livePeer.isClosed) this.setState('connected');
    };
    if (this.fabric.connectDelayMs <= 0) {
      // Immediate, but still asynchronous like a real ICE state change.
      this.connectPending = true;
      void Promise.resolve().then(connect);
    } else {
      this.connectTimer = this.fabric.clock.setTimeout(connect, this.fabric.connectDelayMs);
    }
  }

  private emitCandidatesSoon(): void {
    const count = this.fabric.candidatesPerSession;
    void Promise.resolve().then(() => {
      if (this.closedFlag) return;
      for (let i = 0; i < count; i += 1) {
        const candidate: IceCandidateInit = {
          candidate: `candidate:fake-${this.id}-${i} 1 udp 2130706431 10.0.0.${this.owner === 'host' ? 1 : 2} ${5000 + i} typ host`,
          sdpMid: '0',
          sdpMLineIndex: 0,
        };
        this.localCandidates.push(candidate);
        for (const listener of [...this.candidateListeners]) listener(candidate);
      }
      this.localCandidates.push(null);
      for (const listener of [...this.candidateListeners]) listener(null);
    });
  }

  private sdp(kind: 'offer' | 'answer'): string {
    return `v=0\r\no=fake ${this.id}\r\ns=fake-${kind}\r\nm=audio 9 UDP/TLS/RTP/SAVPF 111\r\na=fake-session:${this.id}\r\n`;
  }

  private setState(next: MediaConnectionState): void {
    if (this.currentState === next) return;
    this.accumulateConnected();
    this.currentState = next;
    if (next === 'connected') this.connectedSince = this.fabric.clock.now();
    for (const listener of [...this.stateListeners]) listener(next);
  }

  private accumulateConnected(): void {
    if (this.connectedSince !== null) {
      this.connectedMs += this.fabric.clock.now() - this.connectedSince;
      this.connectedSince = null;
    }
  }

  private clearConnectTimer(): void {
    if (this.connectTimer !== null) {
      this.fabric.clock.clearTimeout(this.connectTimer);
      this.connectTimer = null;
    }
  }

  private clearFailTimer(): void {
    if (this.failTimer !== null) {
      this.fabric.clock.clearTimeout(this.failTimer);
      this.failTimer = null;
    }
  }

  private clearTimers(): void {
    this.clearConnectTimer();
    this.clearFailTimer();
  }

  private assertOpen(): void {
    if (this.closedFlag) throw new MediaError('closed', 'session is closed');
  }

  private invalid(what: string): MediaError {
    return new MediaError('negotiation-failed', what);
  }
}

export class FakeMediaEngine implements MediaEngine {
  readonly sessions: FakeMediaSession[] = [];
  startCalls = 0;
  stopCalls = 0;
  mutedCalls: boolean[] = [];
  muted = false;
  started = false;
  startOptions: MediaEngineStartOptions | null = null;
  tunables: AudioTunables | null = null;

  private startFailure: unknown = null;
  private startHang = false;
  private sessionFailures: unknown[] = [];
  private sessionHang = false;

  constructor(
    private readonly fabric: FakeMediaFabric,
    readonly owner: string,
  ) {}

  async start(options: MediaEngineStartOptions): Promise<void> {
    this.startCalls += 1;
    this.startOptions = options;
    this.tunables = options.tunables;
    this.muted = options.startMuted;
    if (this.startHang) return new Promise<void>(() => undefined);
    if (this.startFailure !== null) throw this.startFailure;
    this.started = true;
  }

  async createSession(options: MediaSessionOptions = {}): Promise<MediaSession> {
    if (this.sessionHang) return new Promise<MediaSession>(() => undefined);
    const failure = this.sessionFailures.shift();
    if (failure !== undefined) throw failure;
    if (!this.started) throw new MediaError('closed', 'media engine not started');
    const session = new FakeMediaSession(this.fabric, this.owner, options);
    this.sessions.push(session);
    return session;
  }

  setMuted(muted: boolean): void {
    this.muted = muted;
    this.mutedCalls.push(muted);
  }

  async setTunables(tunables: AudioTunables): Promise<void> {
    this.tunables = tunables;
  }

  async stop(): Promise<void> {
    this.stopCalls += 1;
    this.started = false;
    for (const session of this.sessions) await session.close();
  }

  // ---- test controls ----------------------------------------------------------------------------------

  /** media.start() rejects with `error` (default MediaError('capture-failed')). */
  failStart(error: unknown = new MediaError('capture-failed', 'microphone unavailable')): void {
    this.startFailure = error;
  }

  /** media.start() never settles (a hung native call). */
  hangStart(on = true): void {
    this.startHang = on;
  }

  /** The next createSession() rejects with `error` (once). */
  failNextSession(error: unknown = new MediaError('negotiation-failed', 'could not create a session')): void {
    this.sessionFailures.push(error);
  }

  hangCreateSession(on = true): void {
    this.sessionHang = on;
  }

  get currentSession(): FakeMediaSession | undefined {
    for (let i = this.sessions.length - 1; i >= 0; i -= 1) {
      const session = this.sessions[i];
      if (session && !session.isClosed) return session;
    }
    return undefined;
  }

  get openSessions(): number {
    return this.sessions.filter((s) => !s.isClosed).length;
  }
}

export interface FakeMediaPair {
  host: FakeMediaEngine;
  guest: FakeMediaEngine;
  fabric: FakeMediaFabric;
}

export function createFakeMediaPair(options: FakeMediaOptions): FakeMediaPair {
  const fabric = new FakeMediaFabric(options);
  return { host: new FakeMediaEngine(fabric, 'host'), guest: new FakeMediaEngine(fabric, 'guest'), fabric };
}
