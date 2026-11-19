import type { AudioRoute } from '../../platform/audio/AudioRoute';
import type { AudioTunables } from '../../platform/audio/AudioTunables';
import type { LinkKind, LinkRole, LinkTransport } from '../../platform/link/LinkTransport';
import type { MediaEngine, MediaStats } from '../../platform/media/MediaEngine';
import type { PermissionService } from '../../platform/permissions/PermissionService';
import type { RideService } from '../../platform/service/RideService';
import type { Clock, Logger, Unsubscribe } from '../common/types';
import type { PairingRecord } from '../pairing/types';
import type { CryptoProvider } from '../protocol/crypto';
import type { PeerInterruption } from '../protocol/messages';
import type { EstablishSecureChannel } from '../protocol/secureChannel';

/**
 * Session contract between `core-session` (implements) and `ui` / `web-verify` (consume).
 * CONTRACT: owned by the lead. The state machine itself lives in src/core/session and is owned by `core-session`.
 *
 * States (brief): idle -> starting -> linking -> signaling -> connecting -> connected <-> reconnecting -> ended.
 *   starting     acquire permissions, audio route, foreground service, microphone
 *   linking      LinkTransport.open() (host listens/advertises, guest discovers/connects)
 *   signaling    secure handshake, then peer-state + SDP exchange
 *   connecting   ICE / DTLS in progress
 *   connected    media flowing; heartbeats running
 *   reconnecting link or media lost: retry linking -> signaling -> connecting with backoff, for as long as the ride is active
 *   ended        terminal; everything released
 */

export type SessionState =
  'idle' | 'starting' | 'linking' | 'signaling' | 'connecting' | 'connected' | 'reconnecting' | 'ended';

export type SessionErrorCode =
  | 'permission-denied'
  | 'no-headset'
  | 'audio-route-failed'
  | 'link-unavailable'
  | 'auth-failed'
  | 'version-mismatch'
  | 'media-failed'
  | 'service-failed'
  | 'partner-ended'
  | 'unknown';

export interface SessionError {
  code: SessionErrorCode;
  message: string;
  /** true: the session keeps retrying on its own; false: the ride ended or needs the user. */
  recoverable: boolean;
  at: number;
}

export interface PeerState {
  name: string;
  muted: boolean;
  headsetConnected: boolean;
  batteryPct: number | null;
  charging: boolean | null;
  interruption: PeerInterruption;
  updatedAt: number;
}

export interface SessionSnapshot {
  state: SessionState;
  role: LinkRole | null;
  pairId: string | null;
  muted: boolean;
  local: {
    headsetConnected: boolean;
    interruption: PeerInterruption;
    batteryPct: number | null;
  };
  peer: PeerState | null;
  /** Transport of the current/last link. */
  transport: LinkKind | null;
  /** Negotiation generation (increments on every reconnect). */
  generation: number;
  /** Consecutive failed attempts in the current outage; 0 while connected. */
  attempt: number;
  /** Epoch ms when the media last became connected; null if not currently connected. */
  connectedAt: number | null;
  error: SessionError | null;
}

export interface SessionStartOptions {
  pairing: PairingRecord;
  /** This phone's display name, sent to the partner in peer-state. */
  deviceName: string;
  /** Developer override: allow earpiece/speaker when no headset is connected. */
  allowNoHeadset: boolean;
}

export interface SessionController {
  getSnapshot(): SessionSnapshot;
  subscribe(listener: (snapshot: SessionSnapshot) => void): Unsubscribe;
  /** Resolves once the ride loop is running (NOT when connected). Rejects only for programmer errors. */
  start(options: SessionStartOptions): Promise<void>;
  setMuted(muted: boolean): void;
  /** Ends the ride: tells the partner (bye), releases media, audio route and the foreground service. Idempotent. */
  end(): Promise<void>;
  /** Latest live media stats (for the diagnostics screen); null when no media session exists. */
  getMediaStats(): Promise<MediaStats | null>;
}

export interface SessionConfig {
  linkOpenTimeoutMs: number;
  handshakeTimeoutMs: number;
  /** From the first SDP message to media 'connected'. */
  negotiationTimeoutMs: number;
  heartbeatIntervalMs: number;
  /** No pong / no message for this long means the link is dead. */
  heartbeatTimeoutMs: number;
  backoff: { initialMs: number; maxMs: number; factor: number; jitter: number };
}

export const DEFAULT_SESSION_CONFIG: SessionConfig = {
  linkOpenTimeoutMs: 15_000,
  handshakeTimeoutMs: 5_000,
  negotiationTimeoutMs: 10_000,
  heartbeatIntervalMs: 2_000,
  heartbeatTimeoutMs: 6_000,
  backoff: { initialMs: 500, maxMs: 3_000, factor: 1.7, jitter: 0.2 },
};

/** Everything the state machine needs, injected. Real adapters in platform/, fakes in core/session/testing. */
export interface SessionDeps {
  link: LinkTransport;
  media: MediaEngine;
  audio: AudioRoute;
  service: RideService;
  permissions: PermissionService;
  crypto: CryptoProvider;
  clock: Clock;
  logger: Logger;
  /** Read at ride start (and re-read by the tunables store, which also calls media.setTunables live). */
  getTunables: () => AudioTunables;
  /** Defaults to the core/protocol implementation; tests may inject a fake. */
  establishSecureChannel?: EstablishSecureChannel;
  config?: Partial<SessionConfig>;
}

export type CreateSessionController = (deps: SessionDeps) => SessionController;
