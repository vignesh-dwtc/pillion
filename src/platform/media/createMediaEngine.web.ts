/**
 * Web twin of createMediaEngine: the browser's own WebRTC (DEV / WEB VERIFICATION ONLY).
 *
 * Real getUserMedia capture, a fresh RTCPeerConnection per negotiation attempt with `iceServers: []` (host candidates
 * only, like offline mode on a phone), real offer / answer / trickled ICE, real Opus packets, remote audio played
 * through an <audio> element, and stats from `RTCPeerConnection.getStats()`. Playwright's fake microphone feeds it.
 *
 * Web proves negotiation and that audio bytes flow both ways. It says nothing about the native @livekit WebRTC build,
 * Android audio modes, hardware echo cancellation or Bluetooth microphones.
 */
import type { Unsubscribe } from '../../core/common/types';
import { DEFAULT_AUDIO_TUNABLES, type AudioTunables } from '../audio/AudioTunables';

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
import { audioConstraintsFor, mapConnectionState, mapStatsReport, mungeOpusSdp } from './webMediaHelpers.web';

/** Greppable by scripts/check-android-bundle.mjs: this string must never appear in the Android bundle. */
export const WEB_ONLY_MEDIA_ENGINE = '@@web-only:WebMediaEngine@@';

function toCaptureError(error: unknown): MediaError {
  const name = error instanceof Error ? error.name : '';
  const message = error instanceof Error ? error.message : String(error);
  if (name === 'NotAllowedError' || name === 'SecurityError') return new MediaError('permission', message);
  return new MediaError('capture-failed', `${name || 'error'}: ${message}`);
}

function toNegotiationError(error: unknown): MediaError {
  if (error instanceof MediaError) return error;
  const message = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
  return new MediaError('negotiation-failed', message);
}

interface SessionInit {
  track: MediaStreamTrack | null;
  stream: MediaStream | null;
  playRemoteAudio: boolean;
  tunables: AudioTunables;
  onClosed: () => void;
}

class WebMediaSession implements MediaSession {
  private readonly pc: RTCPeerConnection;
  private readonly sender: RTCRtpSender | null;
  private readonly stateListeners = new Set<(state: MediaConnectionState) => void>();
  private readonly candidateListeners = new Set<(candidate: IceCandidateInit | null) => void>();
  /** Local candidates gathered before the first subscriber; flushed in order to the first one. */
  private candidateBacklog: (IceCandidateInit | null)[] | null = [];
  /** Remote candidates that arrived before the remote description was applied. */
  private pendingRemoteCandidates: (IceCandidateInit | null)[] = [];
  private audioElement: HTMLAudioElement | null = null;
  private tunables: AudioTunables;
  private closed = false;

  constructor(private readonly init: SessionInit) {
    this.tunables = init.tunables;
    // No ICE servers: offline mode gathers host candidates only.
    this.pc = new RTCPeerConnection({ iceServers: [], bundlePolicy: 'max-bundle', rtcpMuxPolicy: 'require' });
    if (init.track !== null && init.stream !== null) {
      this.sender = this.pc.addTrack(init.track, init.stream);
    } else {
      this.sender = null;
      this.pc.addTransceiver('audio', { direction: 'recvonly' });
    }

    this.pc.addEventListener('icecandidate', (event) => {
      const candidate = event.candidate;
      this.emitCandidate(
        candidate
          ? {
              candidate: candidate.candidate,
              sdpMid: candidate.sdpMid,
              sdpMLineIndex: candidate.sdpMLineIndex,
            }
          : null,
      );
    });
    this.pc.addEventListener('connectionstatechange', () => {
      const state = this.currentState();
      if (state === 'connected') void this.applySenderParameters();
      for (const listener of [...this.stateListeners]) listener(state);
    });
    this.pc.addEventListener('track', (event) => {
      if (init.playRemoteAudio) this.attachRemoteAudio(event.streams[0] ?? new MediaStream([event.track]));
    });
  }

  async createOffer(options?: { iceRestart?: boolean }): Promise<SessionDescription> {
    this.assertOpen();
    try {
      const offer = await this.pc.createOffer(options?.iceRestart ? { iceRestart: true } : undefined);
      const sdp = mungeOpusSdp(offer.sdp ?? '', this.tunables);
      await this.pc.setLocalDescription({ type: 'offer', sdp });
      return { type: 'offer', sdp: this.pc.localDescription?.sdp ?? sdp };
    } catch (error) {
      throw toNegotiationError(error);
    }
  }

  async acceptOffer(offer: SessionDescription): Promise<SessionDescription> {
    this.assertOpen();
    try {
      await this.pc.setRemoteDescription({ type: 'offer', sdp: offer.sdp });
      await this.flushRemoteCandidates();
      const answer = await this.pc.createAnswer();
      const sdp = mungeOpusSdp(answer.sdp ?? '', this.tunables);
      await this.pc.setLocalDescription({ type: 'answer', sdp });
      return { type: 'answer', sdp: this.pc.localDescription?.sdp ?? sdp };
    } catch (error) {
      throw toNegotiationError(error);
    }
  }

  async acceptAnswer(answer: SessionDescription): Promise<void> {
    this.assertOpen();
    try {
      await this.pc.setRemoteDescription({ type: 'answer', sdp: answer.sdp });
      await this.flushRemoteCandidates();
    } catch (error) {
      throw toNegotiationError(error);
    }
  }

  async addRemoteCandidate(candidate: IceCandidateInit | null): Promise<void> {
    if (this.closed) return;
    if (this.pc.remoteDescription === null) {
      this.pendingRemoteCandidates.push(candidate);
      return;
    }
    await this.applyRemoteCandidate(candidate);
  }

  onLocalCandidate(listener: (candidate: IceCandidateInit | null) => void): Unsubscribe {
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
    this.stateListeners.add(listener);
    const current = this.currentState();
    // A subscriber that arrives after the connection moved on still learns where it stands.
    if (current !== 'new') {
      queueMicrotask(() => {
        if (this.stateListeners.has(listener)) listener(this.currentState());
      });
    }
    return () => {
      this.stateListeners.delete(listener);
    };
  }

  async getStats(): Promise<MediaStats> {
    this.assertOpen();
    const report = await this.pc.getStats();
    return mapStatsReport(report, this.currentState(), Date.now());
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    this.detachRemoteAudio();
    try {
      this.pc.close();
    } catch {
      // already closed
    }
    this.stateListeners.clear();
    this.candidateListeners.clear();
    this.candidateBacklog = null;
    this.pendingRemoteCandidates = [];
    this.init.onClosed();
  }

  /** Called by the engine when tunables change while this session is alive. */
  applyTunables(tunables: AudioTunables): void {
    this.tunables = tunables;
    void this.applySenderParameters();
  }

  private currentState(): MediaConnectionState {
    return this.closed ? 'closed' : mapConnectionState(this.pc.connectionState);
  }

  private assertOpen(): void {
    if (this.closed) throw new MediaError('closed', 'MediaSession is closed');
  }

  private emitCandidate(candidate: IceCandidateInit | null) {
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
    if (this.closed) return;
    try {
      if (candidate === null) {
        await this.pc.addIceCandidate({ candidate: '' }); // remote end-of-candidates
      } else {
        await this.pc.addIceCandidate({
          candidate: candidate.candidate,
          sdpMid: candidate.sdpMid,
          sdpMLineIndex: candidate.sdpMLineIndex,
        });
      }
    } catch {
      // A stale or unusable candidate (for example from before a restart) must not fail the negotiation.
    }
  }

  /** Opus bitrate cap as RTP sender parameters (best effort; SDP `maxaveragebitrate` is the main control). */
  private async applySenderParameters(): Promise<void> {
    if (this.sender === null || this.closed) return;
    try {
      const parameters = this.sender.getParameters();
      const encodings = parameters.encodings?.length ? parameters.encodings : [{}];
      const first = encodings[0];
      if (first === undefined) return;
      first.maxBitrate = this.tunables.opusBitrateBps;
      await this.sender.setParameters({ ...parameters, encodings });
    } catch {
      // Not negotiated yet, or the browser refuses: nothing to do.
    }
  }

  private attachRemoteAudio(stream: MediaStream) {
    if (typeof document === 'undefined') return;
    this.detachRemoteAudio();
    const element = document.createElement('audio');
    element.autoplay = true;
    element.setAttribute('playsinline', '');
    element.hidden = true;
    element.dataset.testid = 'remote-audio';
    element.srcObject = stream;
    document.body.appendChild(element);
    this.audioElement = element;
    element.play().catch(() => {
      // Autoplay blocked: a ride starts from a tap, but retry on the next gesture just in case.
      const retry = () => void element.play().catch(() => undefined);
      document.addEventListener('pointerdown', retry, { once: true });
    });
  }

  private detachRemoteAudio() {
    const element = this.audioElement;
    if (element === null) return;
    this.audioElement = null;
    element.pause();
    element.srcObject = null;
    element.remove();
  }
}

class WebMediaEngine implements MediaEngine {
  private stream: MediaStream | null = null;
  private track: MediaStreamTrack | null = null;
  private muted = false;
  private tunables: AudioTunables = DEFAULT_AUDIO_TUNABLES;
  private readonly sessions = new Set<WebMediaSession>();

  async start(options: MediaEngineStartOptions): Promise<void> {
    this.releaseCapture();
    this.tunables = options.tunables;
    this.muted = options.startMuted;
    const devices = typeof navigator === 'undefined' ? undefined : navigator.mediaDevices;
    if (!devices?.getUserMedia) {
      throw new MediaError(
        'unsupported',
        'getUserMedia is unavailable (it needs a secure context such as http://localhost)',
      );
    }
    let stream: MediaStream;
    try {
      stream = await devices.getUserMedia({ audio: audioConstraintsFor(this.tunables), video: false });
    } catch (error) {
      throw toCaptureError(error);
    }
    const track = stream.getAudioTracks()[0];
    if (track === undefined) {
      for (const stray of stream.getTracks()) stray.stop();
      throw new MediaError('capture-failed', 'the browser returned no audio track');
    }
    track.enabled = !this.muted;
    this.stream = stream;
    this.track = track;
  }

  async createSession(options: MediaSessionOptions = {}): Promise<MediaSession> {
    if (typeof RTCPeerConnection === 'undefined')
      throw new MediaError('unsupported', 'RTCPeerConnection is unavailable');
    const send = options.sendLocalAudio ?? true;
    if (send && (this.track === null || this.stream === null)) {
      throw new MediaError('closed', 'MediaEngine is not started (no microphone)');
    }
    const session = new WebMediaSession({
      track: send ? this.track : null,
      stream: send ? this.stream : null,
      playRemoteAudio: options.playRemoteAudio ?? true,
      tunables: this.tunables,
      onClosed: () => this.sessions.delete(session),
    });
    this.sessions.add(session);
    return session;
  }

  setMuted(muted: boolean): void {
    this.muted = muted;
    // Disabling the track keeps the connection up and sends silence.
    if (this.track !== null) this.track.enabled = !muted;
  }

  async setTunables(tunables: AudioTunables): Promise<void> {
    this.tunables = tunables;
    if (this.track !== null) {
      try {
        await this.track.applyConstraints(audioConstraintsFor(tunables));
      } catch {
        // Applied by the next getUserMedia instead.
      }
    }
    for (const session of this.sessions) session.applyTunables(tunables);
  }

  async stop(): Promise<void> {
    await Promise.all([...this.sessions].map((session) => session.close()));
    this.releaseCapture();
  }

  private releaseCapture() {
    if (this.stream !== null) for (const track of this.stream.getTracks()) track.stop();
    this.stream = null;
    this.track = null;
  }
}

export function createMediaEngine(): MediaEngine {
  return new WebMediaEngine();
}
