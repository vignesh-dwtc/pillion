import type { Unsubscribe } from '../../core/common/types';
import type { AudioTunables } from '../audio/AudioTunables';

/**
 * MediaEngine: audio-only WebRTC (Opus mono). CONTRACT: owned by the lead.
 * Native implementation: WebRtcMediaEngine over @livekit/react-native-webrtc (`media` subagent).
 * Web implementation: the browser's own RTCPeerConnection (`web-verify`). Fakes: `core-session`.
 *
 * Two levels, so a reconnect does not re-acquire the microphone:
 *   MediaEngine  - lives for the whole ride: microphone capture, mute, tunables.
 *   MediaSession - one per negotiation attempt: a fresh RTCPeerConnection with NO ICE servers
 *                  (offline mode = host candidates only, no STUN/TURN). Discarded on every reconnect.
 *
 * Roles: the host creates the offer, the guest accepts it (the session layer decides; the engine is symmetric).
 */

export interface SessionDescription {
  type: 'offer' | 'answer';
  sdp: string;
}

export interface IceCandidateInit {
  candidate: string;
  sdpMid: string | null;
  sdpMLineIndex: number | null;
}

export type MediaConnectionState = 'new' | 'checking' | 'connected' | 'disconnected' | 'failed' | 'closed';

export interface IceCandidateInfo {
  id: string;
  type: 'host' | 'srflx' | 'prflx' | 'relay' | 'unknown';
  protocol: 'udp' | 'tcp' | 'unknown';
  address: string | null;
  port: number | null;
  /** e.g. 'wifi' | 'cellular' | 'unknown' when the platform reports it. */
  networkType: string | null;
}

export interface SelectedCandidatePair {
  local: IceCandidateInfo;
  remote: IceCandidateInfo;
  state: string;
  rttMs: number | null;
}

/** Cumulative counters; the diagnostics sampler turns them into rates. */
export interface MediaStats {
  timestamp: number;
  connectionState: MediaConnectionState;
  selectedPair: SelectedCandidatePair | null;
  /** Every candidate gathered locally / received from the partner (diagnostics: risk 1). */
  localCandidates: IceCandidateInfo[];
  remoteCandidates: IceCandidateInfo[];
  rttMs: number | null;
  jitterMs: number | null;
  packetsSent: number;
  packetsReceived: number;
  packetsLost: number;
  /** RTP payload bytes. The two-peer e2e test asserts both directions increase. */
  bytesSent: number;
  bytesReceived: number;
  /** 0..1 audio levels of the microphone and of the partner's audio being played. */
  inputLevel: number | null;
  outputLevel: number | null;
  /** e.g. 'opus/48000/2'. */
  codec: string | null;
}

export interface MediaEngineStartOptions {
  tunables: AudioTunables;
  startMuted: boolean;
}

export interface MediaSessionOptions {
  /** Add the local microphone track. Default true. The loopback self-test's receiving side sets false. */
  sendLocalAudio?: boolean;
  /** Play the remote audio. Default true. */
  playRemoteAudio?: boolean;
}

export type MediaErrorCode =
  'permission' | 'capture-failed' | 'negotiation-failed' | 'unsupported' | 'closed';

export class MediaError extends Error {
  readonly code: MediaErrorCode;
  constructor(code: MediaErrorCode, message?: string) {
    super(message ?? code);
    this.name = 'MediaError';
    this.code = code;
  }
}

export interface MediaSession {
  createOffer(options?: { iceRestart?: boolean }): Promise<SessionDescription>;
  /** Applies the remote offer and returns the local answer. */
  acceptOffer(offer: SessionDescription): Promise<SessionDescription>;
  acceptAnswer(answer: SessionDescription): Promise<void>;
  /** null = remote end-of-candidates. */
  addRemoteCandidate(candidate: IceCandidateInit | null): Promise<void>;
  /** null = local end-of-candidates. */
  onLocalCandidate(listener: (candidate: IceCandidateInit | null) => void): Unsubscribe;
  onState(listener: (state: MediaConnectionState) => void): Unsubscribe;
  getStats(): Promise<MediaStats>;
  close(): Promise<void>;
}

export interface MediaEngine {
  /** Acquires the microphone and prepares the factory. Rejects with MediaError('permission' | 'capture-failed'). */
  start(options: MediaEngineStartOptions): Promise<void>;
  /** Creates a fresh peer connection. Any previous session should already be closed by the caller. */
  createSession(options?: MediaSessionOptions): Promise<MediaSession>;
  /** Mutes/unmutes by disabling the local track (the connection stays up). */
  setMuted(muted: boolean): void;
  /** Applies live where possible (constraints, sender parameters); otherwise on the next createSession(). */
  setTunables(tunables: AudioTunables): Promise<void>;
  /** Releases the microphone and every session. */
  stop(): Promise<void>;
}
