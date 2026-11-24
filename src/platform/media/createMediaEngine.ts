/**
 * Native MediaEngine: `WebRtcMediaEngine` / `WebRtcMediaSession` over `@livekit/react-native-webrtc` 150.1.1.
 * The web twin is `createMediaEngine.web.ts` (browser WebRTC, owned by `web-verify`).
 *
 * Every package call below was checked against the installed source (`node_modules/@livekit/react-native-webrtc/src`):
 *   - `mediaDevices.getUserMedia({ audio })` resolves a `MediaStream`; it rejects with a `MediaStreamError`
 *     (a plain object, NOT an `Error`) named `SecurityError` when the microphone permission is refused
 *     (getUserMedia.ts), or with whatever name the native side reports.
 *   - The audio constraint keys the Android side reads are exactly the four of `toGetUserMediaConstraints`
 *     (GetUserMediaImpl.java `createAudioTrack`). The package's `MediaTrackConstraints` type only lists video keys,
 *     hence the one cast in `captureStream`.
 *   - `MediaStreamTrack.applyConstraints` is a no-op for audio ("Only implemented for video tracks"), so changing a
 *     capture constraint needs a new track: getUserMedia again + `RTCRtpSender.replaceTrack`.
 *   - `MediaStreamTrack.stop()` only flips `enabled`; the native track and its AudioSource are freed by
 *     `MediaStream.release()` (mediaStreamTrackRelease + mediaStreamRelease). `stop()` therefore calls `release()`.
 *   - `RTCPeerConnection.close()` asks native to close; the JS object disposes the native peer connection when the
 *     `closed` connection state arrives (RTCPeerConnection.ts `_registerEvents`).
 *   - `addIceCandidate(null | {candidate: ''})` is a no-op (end-of-candidates is not implemented by the package).
 *   - Gathering complete is dispatched as an `icecandidate` event with `candidate: null`.
 *   - `RTCRtpSender.setParameters` round-trips the parameters through native; `encodings[i].maxBitrate` is a setter.
 *   - Remote audio plays through the audio device module without any view; `MediaStreamTrack._setVolume(0)` on the
 *     remote track silences it (used for `playRemoteAudio: false`).
 *
 * Compiles and unit-tested (Jest, mocked package), untested on device.
 */
import {
  mediaDevices,
  RTCPeerConnection,
  type MediaStream,
  type MediaStreamTrack,
  type RTCRtpSender,
} from '@livekit/react-native-webrtc';

import type { Unsubscribe } from '../../core/common/types';
import { DEFAULT_AUDIO_TUNABLES, type AudioTunables } from '../audio/AudioTunables';
import { captureConstraintsDiffer, clampTunables, toGetUserMediaConstraints } from '../audio/tunables';

import {
  MediaError,
  type IceCandidateInit,
  type MediaConnectionState,
  type MediaEngine,
  type MediaEngineStartOptions,
  type MediaSession,
  type MediaSessionOptions,
  type MediaStats,
  type SessionDescription,
} from './MediaEngine';
import { applyOpusTunables } from './sdp';
import { mapStatsReport, type StatsEntries } from './stats';

type PackageConstraints = Parameters<typeof mediaDevices.getUserMedia>[0];

/** Name of a thrown value: works for `Error`s and for the package's plain `MediaStreamError` objects. */
function errorName(error: unknown): string {
  if (typeof error === 'object' && error !== null && 'name' in error) {
    const name = (error as { name: unknown }).name;
    if (typeof name === 'string') return name;
  }
  return '';
}

function errorMessage(error: unknown): string {
  if (typeof error === 'object' && error !== null && 'message' in error) {
    const message = (error as { message: unknown }).message;
    if (typeof message === 'string' && message !== '') return message;
  }
  return typeof error === 'string' ? error : 'unknown error';
}

/** getUserMedia failure -> MediaError('permission' | 'capture-failed'). */
export function toCaptureError(error: unknown): MediaError {
  if (error instanceof MediaError) return error;
  const name = errorName(error);
  const message = errorMessage(error);
  if (name === 'SecurityError' || name === 'NotAllowedError' || name === 'PermissionDeniedError') {
    return new MediaError('permission', `${name}: ${message}`);
  }
  return new MediaError('capture-failed', `${name || 'error'}: ${message}`);
}

/** Negotiation failure -> MediaError('negotiation-failed'); MediaErrors pass through. */
export function toNegotiationError(error: unknown): MediaError {
  if (error instanceof MediaError) return error;
  const name = errorName(error);
  return new MediaError('negotiation-failed', `${name || 'error'}: ${errorMessage(error)}`);
}

/** RTCPeerConnection.connectionState (or iceConnectionState) -> the contract's MediaConnectionState. */
export function mapConnectionState(state: string | null | undefined): MediaConnectionState {
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

interface Capture {
  stream: MediaStream;
  track: MediaStreamTrack;
}

async function captureStream(tunables: AudioTunables, muted: boolean): Promise<Capture> {
  let stream: MediaStream;
  try {
    // The package's MediaTrackConstraints type lists only video keys; the Android side reads these four audio keys.
    const audio = toGetUserMediaConstraints(tunables) as unknown as PackageConstraints['audio'];
    stream = await mediaDevices.getUserMedia({ audio });
  } catch (error) {
    throw toCaptureError(error);
  }
  const track = stream.getAudioTracks()[0];
  if (track === undefined) {
    releaseStream(stream);
    throw new MediaError('capture-failed', 'getUserMedia returned no audio track');
  }
  track.enabled = !muted;
  return { stream, track };
}

function releaseStream(stream: MediaStream | null): void {
  if (stream === null) return;
  try {
    stream.release(true);
  } catch {
    // already released
  }
}

interface SessionInit {
  /** Current microphone track to send, or null for a receive-only session. */
  track: MediaStreamTrack | null;
  stream: MediaStream | null;
  playRemoteAudio: boolean;
  tunables: AudioTunables;
  onClosed: (session: WebRtcMediaSession) => void;
}

export class WebRtcMediaSession implements MediaSession {
  private readonly pc: RTCPeerConnection;
  private sender: RTCRtpSender | null = null;
  private readonly sendsAudio: boolean;
  private readonly stateListeners = new Set<(state: MediaConnectionState) => void>();
  private readonly candidateListeners = new Set<(candidate: IceCandidateInit | null) => void>();
  /** Local candidates gathered before the first subscriber; flushed in order to it. null once flushed. */
  private candidateBacklog: (IceCandidateInit | null)[] | null = [];
  /** Remote candidates that arrived before the remote description; applied right after it. */
  private pendingRemoteCandidates: (IceCandidateInit | null)[] = [];
  private remoteDescriptionApplied = false;
  private lastState: MediaConnectionState = 'new';
  private tunables: AudioTunables;
  private closed = false;

  constructor(private readonly init: SessionInit) {
    this.tunables = init.tunables;
    try {
      // No ICE servers: offline mode gathers host candidates only (no STUN/TURN).
      this.pc = new RTCPeerConnection({
        iceServers: [],
        bundlePolicy: 'max-bundle',
        rtcpMuxPolicy: 'require',
      });
    } catch (error) {
      throw toNegotiationError(error);
    }
    this.sendsAudio = init.track !== null && init.stream !== null;
    if (init.track !== null && init.stream !== null) {
      try {
        this.sender = this.pc.addTrack(init.track, init.stream);
      } catch (error) {
        this.pc.close();
        throw toNegotiationError(error);
      }
    }

    this.pc.addEventListener('icecandidate', (event) => {
      const candidate = event.candidate;
      this.emitCandidate(
        candidate && candidate.candidate
          ? {
              candidate: candidate.candidate,
              sdpMid: candidate.sdpMid ?? null,
              sdpMLineIndex: candidate.sdpMLineIndex ?? null,
            }
          : null,
      );
    });
    this.pc.addEventListener('connectionstatechange', () => this.onConnectionStateChange());
    this.pc.addEventListener('track', (event) => {
      const track = event.track;
      if (track === null || track.kind !== 'audio' || init.playRemoteAudio) return;
      try {
        track._setVolume(0);
      } catch {
        // best effort: a receive-side volume failure must not break the session
      }
    });
  }

  async createOffer(options?: { iceRestart?: boolean }): Promise<SessionDescription> {
    this.assertOpen();
    try {
      if (!this.sendsAudio && this.pc.getTransceivers().length === 0) {
        // A receive-only offerer still needs an audio m-line.
        this.pc.addTransceiver('audio', { direction: 'recvonly' });
      }
      const offer = await this.pc.createOffer(options?.iceRestart ? { iceRestart: true } : undefined);
      this.assertOpen();
      const sdp = applyOpusTunables(offer.sdp ?? '', this.tunables);
      await this.pc.setLocalDescription({ type: 'offer', sdp });
      return { type: 'offer', sdp: this.pc.localDescription?.sdp || sdp };
    } catch (error) {
      throw toNegotiationError(error);
    }
  }

  async acceptOffer(offer: SessionDescription): Promise<SessionDescription> {
    this.assertOpen();
    try {
      await this.pc.setRemoteDescription({ type: 'offer', sdp: offer.sdp });
      this.remoteDescriptionApplied = true;
      await this.flushRemoteCandidates();
      this.assertOpen();
      const answer = await this.pc.createAnswer();
      this.assertOpen();
      const sdp = applyOpusTunables(answer.sdp ?? '', this.tunables);
      await this.pc.setLocalDescription({ type: 'answer', sdp });
      return { type: 'answer', sdp: this.pc.localDescription?.sdp || sdp };
    } catch (error) {
      throw toNegotiationError(error);
    }
  }

  async acceptAnswer(answer: SessionDescription): Promise<void> {
    this.assertOpen();
    try {
      await this.pc.setRemoteDescription({ type: 'answer', sdp: answer.sdp });
      this.remoteDescriptionApplied = true;
      await this.flushRemoteCandidates();
    } catch (error) {
      throw toNegotiationError(error);
    }
  }

  async addRemoteCandidate(candidate: IceCandidateInit | null): Promise<void> {
    if (this.closed) return;
    if (!this.remoteDescriptionApplied) {
      this.pendingRemoteCandidates.push(candidate);
      return;
    }
    await this.applyRemoteCandidate(candidate);
  }

  onLocalCandidate(listener: (candidate: IceCandidateInit | null) => void): Unsubscribe {
    if (this.closed) return () => undefined;
    this.candidateListeners.add(listener);
    if (this.candidateBacklog !== null) {
      const backlog = this.candidateBacklog;
      this.candidateBacklog = null;
      for (const candidate of backlog) listener(candidate);
    }
    return () => {
      this.candidateListeners.delete(listener);
    };
  }

  onState(listener: (state: MediaConnectionState) => void): Unsubscribe {
    if (this.closed) return () => undefined;
    this.stateListeners.add(listener);
    // A subscriber that arrives after the connection moved on still learns where it stands.
    if (this.lastState !== 'new') {
      queueMicrotask(() => {
        if (this.stateListeners.has(listener) && !this.closed) listener(this.lastState);
      });
    }
    return () => {
      this.stateListeners.delete(listener);
    };
  }

  async getStats(): Promise<MediaStats> {
    this.assertOpen();
    let report: StatsEntries;
    try {
      report = (await this.pc.getStats()) as StatsEntries;
    } catch (error) {
      throw toNegotiationError(error);
    }
    return mapStatsReport(report, Date.now(), this.closed ? 'closed' : this.lastState);
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    this.lastState = 'closed';
    this.stateListeners.clear();
    this.candidateListeners.clear();
    this.candidateBacklog = null;
    this.pendingRemoteCandidates = [];
    this.sender = null;
    try {
      this.pc.close();
    } catch {
      // already closed
    }
    this.init.onClosed(this);
  }

  /** Engine -> session: new tunables (SDP munging of the next local description + sender bitrate cap now). */
  async applyTunables(tunables: AudioTunables): Promise<void> {
    this.tunables = tunables;
    await this.applySenderParameters();
  }

  /** Engine -> session: the microphone track was replaced (capture constraints changed). */
  async replaceTrack(track: MediaStreamTrack): Promise<void> {
    if (this.closed || this.sender === null) return;
    await this.sender.replaceTrack(track);
  }

  /** Test/diagnostic hook: the current connection state as the session reports it. */
  get state(): MediaConnectionState {
    return this.lastState;
  }

  private onConnectionStateChange(): void {
    if (this.closed) return;
    const state = mapConnectionState(this.pc.connectionState);
    if (state === this.lastState) return;
    this.lastState = state;
    if (state === 'connected') void this.applySenderParameters();
    for (const listener of [...this.stateListeners]) listener(state);
  }

  private assertOpen(): void {
    if (this.closed) throw new MediaError('closed', 'MediaSession is closed');
  }

  private emitCandidate(candidate: IceCandidateInit | null): void {
    if (this.closed) return;
    if (this.candidateBacklog !== null) {
      this.candidateBacklog.push(candidate);
      return;
    }
    for (const listener of [...this.candidateListeners]) listener(candidate);
  }

  private async flushRemoteCandidates(): Promise<void> {
    const pending = this.pendingRemoteCandidates;
    this.pendingRemoteCandidates = [];
    for (const candidate of pending) await this.applyRemoteCandidate(candidate);
  }

  private async applyRemoteCandidate(candidate: IceCandidateInit | null): Promise<void> {
    // The package ignores end-of-candidates (null / empty candidate), so there is nothing to forward.
    if (this.closed || candidate === null || candidate.candidate === '') return;
    try {
      await this.pc.addIceCandidate({
        candidate: candidate.candidate,
        sdpMid: candidate.sdpMid,
        sdpMLineIndex: candidate.sdpMLineIndex,
      });
    } catch {
      // A stale or unusable candidate (e.g. an interface that just vanished) must not fail the negotiation.
    }
  }

  /** Sender-side Opus bitrate cap (SDP `maxaveragebitrate` states what the PARTNER may send us). */
  private async applySenderParameters(): Promise<void> {
    const sender = this.sender;
    if (sender === null || this.closed || this.lastState !== 'connected') return;
    try {
      const parameters = sender.getParameters();
      const first = parameters.encodings[0];
      if (first === undefined) return;
      const bitrate = clampTunables(this.tunables).opusBitrateBps;
      if (first.maxBitrate === bitrate) return;
      first.maxBitrate = bitrate;
      await sender.setParameters(parameters);
    } catch {
      // Best effort: the SDP fmtp is the main control and is always applied.
    }
  }
}

export class WebRtcMediaEngine implements MediaEngine {
  private capture: Capture | null = null;
  private muted = false;
  private tunables: AudioTunables = DEFAULT_AUDIO_TUNABLES;
  private readonly sessions = new Set<WebRtcMediaSession>();
  /** Serialises start/stop/setTunables so a track swap never races a release. */
  private queue: Promise<unknown> = Promise.resolve();

  start(options: MediaEngineStartOptions): Promise<void> {
    return this.serialise(async () => {
      this.releaseCapture();
      this.tunables = clampTunables(options.tunables);
      this.muted = options.startMuted;
      this.capture = await captureStream(this.tunables, this.muted);
    });
  }

  async createSession(options: MediaSessionOptions = {}): Promise<MediaSession> {
    const send = options.sendLocalAudio ?? true;
    const capture = this.capture;
    if (send && capture === null) {
      throw new MediaError('closed', 'MediaEngine is not started (no microphone)');
    }
    const session = new WebRtcMediaSession({
      track: send && capture ? capture.track : null,
      stream: send && capture ? capture.stream : null,
      playRemoteAudio: options.playRemoteAudio ?? true,
      tunables: this.tunables,
      onClosed: (closed) => this.sessions.delete(closed),
    });
    this.sessions.add(session);
    return session;
  }

  setMuted(muted: boolean): void {
    this.muted = muted;
    // Disabling the track keeps the connection up and sends silence.
    if (this.capture !== null) this.capture.track.enabled = !muted;
  }

  setTunables(tunables: AudioTunables): Promise<void> {
    return this.serialise(async () => {
      const next = clampTunables(tunables);
      const previous = this.tunables;
      this.tunables = next;
      const sessions = [...this.sessions];
      for (const session of sessions) await session.applyTunables(next);
      if (this.capture === null || !captureConstraintsDiffer(previous, next)) return;

      // Audio applyConstraints is a no-op in this package: capture a new track, swap it into every sender,
      // then release the old one. If the new capture fails the old track stays in use.
      const old = this.capture;
      const fresh = await captureStream(next, this.muted);
      this.capture = fresh;
      // Current set, not the snapshot: a session created while getUserMedia ran holds the old track too.
      for (const session of [...this.sessions]) {
        try {
          await session.replaceTrack(fresh.track);
        } catch {
          // the session keeps sending the old (soon silent) track; the next session uses the new one
        }
      }
      releaseStream(old.stream);
    });
  }

  stop(): Promise<void> {
    return this.serialise(async () => {
      await Promise.all([...this.sessions].map((session) => session.close()));
      this.sessions.clear();
      this.releaseCapture();
    });
  }

  private releaseCapture(): void {
    const capture = this.capture;
    this.capture = null;
    if (capture === null) return;
    try {
      capture.track.enabled = false;
    } catch {
      // ignore
    }
    releaseStream(capture.stream);
  }

  private serialise<T>(task: () => Promise<T>): Promise<T> {
    const run = this.queue.then(task, task);
    this.queue = run.catch(() => undefined);
    return run;
  }
}

export function createMediaEngine(): MediaEngine {
  return new WebRtcMediaEngine();
}
