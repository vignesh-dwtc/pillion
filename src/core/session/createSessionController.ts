import type { AudioRouteState, CueKind } from '../../platform/audio/AudioRoute';
import type { MediaStats } from '../../platform/media/MediaEngine';
import type { PermissionKey, PermissionStatus } from '../../platform/permissions/PermissionService';
import type { RideServiceAction } from '../../platform/service/RideService';
import type { LogData, LogLevel, TimerHandle, Unsubscribe } from '../common/types';
import type { CryptoProvider } from '../protocol/crypto';
import { PAIR_ID_BYTES, SECRET_BYTES } from '../protocol/constants';
import { establishSecureChannel } from '../protocol/establish';
import type { ByeReason, PeerStateMessage } from '../protocol/messages';
import type { EstablishSecureChannel } from '../protocol/secureChannel';
import { Scope, ScopeCancelled, detach, settleCall, settleWithin, sleep } from './async';
import { createReconnectBackoff, type ReconnectBackoff } from './backoff';
import { decodeBase64Url } from './base64url';
import { INTERNAL_TIMINGS, resolveSessionConfig } from './config';
import { ConnectionAttempt, type AttemptHooks, type AttemptPhase } from './connectionAttempt';
import { cueForTransition } from './cues';
import { FatalFailure, describeError, failureFromMediaStartError, type Failure } from './errors';
import { sanitizePeerName, sanitizePeerState } from './inbound';
import { RIDE_CHANNEL_ID, RIDE_CHANNEL_NAME, buildRideNotification } from './notification';
import type {
  SessionConfig,
  SessionController,
  SessionDeps,
  SessionError,
  SessionSnapshot,
  SessionStartOptions,
} from './types';

/**
 * The session state machine.
 *
 *   idle -> starting -> linking -> signaling -> connecting -> connected <-> reconnecting -> ended
 *
 * One controller runs exactly one ride: `end()` disposes the injected `LinkTransport` (its contract: unusable
 * afterwards), so the composition root creates a fresh controller and transport per ride.
 *
 * Structure
 *  - `starting` acquires, in order: permissions, audio route, foreground service, microphone. Any failure there
 *    ends the ride with a precise error and releases whatever was acquired.
 *  - `connectLoop` then runs `ConnectionAttempt`s back to back for as long as the ride is active. One attempt is
 *    link -> handshake -> peer state -> SDP/ICE -> media connected -> heartbeats. Every failure of an attempt is
 *    recoverable by construction (see errors.ts) and leads to a backoff sleep and a brand-new attempt, so the
 *    first connection and every recovery take the same code path and the session never gives up on its own.
 *  - State shown to the UI: before the first connection the attempt's own phases (linking / signaling /
 *    connecting); after it, `connected` while media flows and `reconnecting` for the whole outage, however many
 *    attempts it takes.
 *  - The ride ends only through `end()`, an authenticated `bye` from the partner, or a failure that retrying cannot
 *    fix. Everything is released in one finally path (`doShutdown`): attempt, microphone, service, audio route,
 *    link.
 *
 * Nothing here touches a real timer, `Math.random` or `Date`: time is the injected `Clock`, jitter comes from the
 * injected `CryptoProvider`.
 */

export interface SessionControllerWithStats extends SessionController {
  /**
   * Live statistics of the current media session, for the diagnostics screen; null when there is none.
   * (The frozen `SessionController` has no accessor for this: see the contract change request in the report.)
   */
  getMediaStats(): Promise<MediaStats | null>;
}

const INITIAL_SNAPSHOT: SessionSnapshot = {
  state: 'idle',
  role: null,
  pairId: null,
  muted: false,
  local: { headsetConnected: false, interruption: 'none', batteryPct: null },
  peer: null,
  transport: null,
  generation: 0,
  attempt: 0,
  connectedAt: null,
  error: null,
};

interface ShutdownOutcome {
  /** The error the ride ended with; null when the local user ended it. */
  error: SessionError | null;
  byLocalUser: boolean;
  /** Sent to the partner before the link is closed (best effort). */
  bye: ByeReason | null;
}

/** A uniformly distributed float in [0, 1) from the injected random source. */
function randomUnit(crypto: CryptoProvider): number {
  try {
    const bytes = crypto.randomBytes(4);
    const value =
      (bytes[0] ?? 0) * 0x1000000 + (bytes[1] ?? 0) * 0x10000 + (bytes[2] ?? 0) * 0x100 + (bytes[3] ?? 0);
    return value / 0x100000000;
  } catch {
    return 0.5;
  }
}

function toHex(bytes: Uint8Array): string {
  let out = '';
  for (const byte of bytes) out += byte.toString(16).padStart(2, '0');
  return out;
}

/** Replaces every occurrence of the given sensitive literals with a marker. Literals shorter than 6 are ignored. */
function createScrubber(literals: readonly (string | undefined)[]): (text: string) => string {
  const needles = literals.filter(
    (literal): literal is string => typeof literal === 'string' && literal.length >= 6,
  );
  return (text) => {
    let out = text;
    for (const needle of needles) {
      if (out.includes(needle)) out = out.split(needle).join('[redacted]');
    }
    return out;
  };
}

/** Runs `fn` and always returns a promise, even when `fn` throws synchronously. */
function callAsync<T>(fn: () => PromiseLike<T> | T): Promise<T> {
  try {
    return Promise.resolve(fn());
  } catch (error) {
    return Promise.reject(error);
  }
}

const PERMISSION_LABELS: Record<PermissionKey, string> = {
  microphone: 'Microphone',
  bluetooth: 'Bluetooth',
  notifications: 'Notification',
  nearbyDevices: 'Nearby devices',
};

class SessionControllerImpl implements SessionControllerWithStats {
  private snapshot: SessionSnapshot = INITIAL_SNAPSHOT;
  private readonly listeners = new Set<(snapshot: SessionSnapshot) => void>();
  private readonly config: SessionConfig;
  private readonly backoff: ReconnectBackoff;
  private readonly establish: EstablishSecureChannel;
  private readonly rideScope = new Scope<'shutdown'>();

  private options: SessionStartOptions | null = null;
  private deviceName = '';
  private secret: Uint8Array | null = null;
  private scrub: (text: string) => string = (text) => text;

  private started = false;
  private stopRequested = false;
  private finished = false;
  private loopPromise: Promise<void> | null = null;
  private shutdownPromise: Promise<void> | null = null;
  private currentAttempt: ConnectionAttempt | null = null;

  private hasConnectedOnce = false;
  private failedAttempts = 0;
  private charging: boolean | null = null;

  // Acquired resources. A non-null `*Start` means the call was made (finished or not): release must stop it.
  private audioStart: Promise<unknown> | null = null;
  private serviceStart: Promise<unknown> | null = null;
  private mediaStart: Promise<unknown> | null = null;
  private mediaReady = false;
  private serviceReady = false;
  private audioOff: Unsubscribe | null = null;
  private serviceOff: Unsubscribe | null = null;
  private batteryTimer: TimerHandle | null = null;
  private lastNotification = '';
  private notificationChain: Promise<void> = Promise.resolve();

  constructor(private readonly deps: SessionDeps) {
    this.config = resolveSessionConfig(deps.config);
    this.backoff = createReconnectBackoff(this.config.backoff, () => randomUnit(deps.crypto));
    this.establish = deps.establishSecureChannel ?? establishSecureChannel;
  }

  // ---- SessionController ------------------------------------------------------------------------------

  getSnapshot(): SessionSnapshot {
    return this.snapshot;
  }

  /** Listeners are called after every change, never synchronously on subscribe (useSyncExternalStore style). */
  subscribe(listener: (snapshot: SessionSnapshot) => void): Unsubscribe {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  start(options: SessionStartOptions): Promise<void> {
    try {
      this.begin(options);
      return Promise.resolve();
    } catch (error) {
      return Promise.reject(error);
    }
  }

  setMuted(muted: boolean): void {
    if (this.finished || this.stopRequested) return;
    const next = muted === true;
    if (this.snapshot.muted === next) return;
    this.patch({ muted: next });
    if (this.mediaReady) {
      try {
        this.deps.media.setMuted(next);
      } catch (error) {
        this.log('warn', 'media.setMuted failed', { error: describeError(error) });
      }
    }
    this.currentAttempt?.sendPeerState();
  }

  end(): Promise<void> {
    return this.requestShutdown({ error: null, byLocalUser: true, bye: 'user-ended' });
  }

  getMediaStats(): Promise<MediaStats | null> {
    const attempt = this.currentAttempt;
    return attempt ? attempt.getMediaStats() : Promise.resolve(null);
  }

  // ---- start ------------------------------------------------------------------------------------------

  private begin(options: SessionStartOptions): void {
    if (this.started || this.shutdownPromise !== null || this.snapshot.state !== 'idle') {
      throw new Error('SessionController runs one ride: start() was already called or the ride has ended');
    }
    const pairing = options?.pairing;
    if (!pairing || (pairing.role !== 'host' && pairing.role !== 'guest')) {
      throw new TypeError('start: pairing.role must be "host" or "guest"');
    }
    const pairId = typeof pairing.pairId === 'string' ? decodeBase64Url(pairing.pairId) : null;
    if (pairId === null || pairId.length !== PAIR_ID_BYTES) {
      throw new TypeError('start: pairing.pairId must be base64url of 16 bytes');
    }
    const secret = typeof pairing.secret === 'string' ? decodeBase64Url(pairing.secret) : null;
    if (secret === null || secret.length !== SECRET_BYTES) {
      throw new TypeError('start: pairing.secret must be base64url of 32 bytes');
    }

    this.started = true;
    this.options = options;
    this.secret = secret;
    this.deviceName = sanitizePeerName(options.deviceName, 'Phone');
    const standard = `${pairing.secret.replace(/-/g, '+').replace(/_/g, '/')}=`;
    this.scrub = createScrubber([pairing.secret, standard, toHex(secret), pairing.wifiDirect?.passphrase]);

    this.log('info', 'ride starting', {
      role: pairing.role,
      allowNoHeadset: options.allowNoHeadset === true,
    });
    this.patch({ state: 'starting', role: pairing.role, pairId: pairing.pairId });
    this.loopPromise = this.rideLoop();
  }

  private requireOptions(): SessionStartOptions {
    if (!this.options) throw new Error('session not started');
    return this.options;
  }

  // ---- the ride loop ----------------------------------------------------------------------------------

  private async rideLoop(): Promise<void> {
    try {
      await this.startResources();
      await this.connectLoop();
    } catch (error) {
      // A cancelled scope means shutdown was requested elsewhere, which also does the cleanup.
      if (error instanceof ScopeCancelled) return;
      const failure: Failure =
        error instanceof FatalFailure
          ? error.failure
          : {
              code: 'unknown',
              message: 'Something went wrong.',
              recoverable: false,
              detail: describeError(error),
            };
      this.log('error', 'ride cannot continue', { code: failure.code, detail: failure.detail });
      detach(this.requestShutdown({ error: this.toSessionError(failure), byLocalUser: false, bye: null }));
    }
  }

  private async connectLoop(): Promise<void> {
    const options = this.requireOptions();
    const secret = this.secret;
    if (!secret) throw new Error('session not started');
    const { link, media, crypto, clock } = this.deps;
    while (!this.stopRequested) {
      const attempt = new ConnectionAttempt({
        role: options.pairing.role,
        pairId: options.pairing.pairId,
        wifiDirect: options.pairing.wifiDirect,
        secret,
        link,
        media,
        crypto,
        clock,
        config: this.config,
        establish: this.establish,
        hooks: this.attemptHooks(),
        log: (level, message, data) => this.log(level, message, data),
      });
      this.currentAttempt = attempt;
      const end = await attempt.start();
      this.currentAttempt = null;
      if (this.stopRequested) return;
      if (end.kind === 'failed' && !end.failure.recoverable) throw new FatalFailure(end.failure);
      const delay = this.backoff.next();
      this.log('info', 'retrying', { delayMs: delay, failedAttempts: this.failedAttempts });
      await sleep(clock, delay, this.rideScope);
    }
  }

  private attemptHooks(): AttemptHooks {
    return {
      phase: (phase) => this.onPhase(phase),
      linkOpened: (endpoint) => this.patch({ transport: endpoint.kind }),
      localPeerState: () => this.localPeerState(),
      peerState: (message) => this.patch({ peer: sanitizePeerState(message, this.deps.clock.now()) }),
      nextGeneration: () => {
        const generation = this.snapshot.generation + 1;
        this.patch({ generation });
        return generation;
      },
      adoptGeneration: (generation) => this.patch({ generation }),
      isMuted: () => this.snapshot.muted,
      connected: () => this.onConnected(),
      failed: (failure, wasConnected) => this.onAttemptFailed(failure, wasConnected),
      bye: (reason) => this.onBye(reason),
    };
  }

  private onPhase(phase: AttemptPhase): void {
    // After the first connection the whole outage is one `reconnecting` state, whatever the attempt is doing.
    if (this.stopRequested || this.hasConnectedOnce) return;
    this.patch({ state: phase });
  }

  private onConnected(): void {
    if (this.stopRequested) return;
    this.hasConnectedOnce = true;
    this.failedAttempts = 0;
    this.backoff.reset();
    this.patch({ state: 'connected', connectedAt: this.deps.clock.now(), attempt: 0, error: null });
  }

  private onAttemptFailed(failure: Failure, wasConnected: boolean): void {
    if (this.stopRequested) return;
    const loud = this.failedAttempts < 3 || this.failedAttempts % 10 === 0 || wasConnected;
    this.log(loud ? 'warn' : 'debug', 'attempt failed', {
      code: failure.code,
      recoverable: failure.recoverable,
      wasConnected,
      detail: failure.detail,
    });
    // A failure retrying cannot fix ends the ride from the loop; it must not flash up as a retry first.
    if (!failure.recoverable) return;
    this.failedAttempts += 1;
    const error = this.toSessionError(failure);
    if (this.hasConnectedOnce) {
      this.patch({ state: 'reconnecting', connectedAt: null, attempt: this.failedAttempts, error });
    } else {
      this.patch({ state: 'linking', attempt: this.failedAttempts, error });
    }
  }

  private onBye(reason: ByeReason): void {
    this.log('info', 'partner ended the ride', { reason });
    const message =
      reason === 'phone-call'
        ? 'Your partner ended the ride because of a phone call.'
        : reason === 'error'
          ? 'Your partner ended the ride after an error.'
          : 'Your partner ended the ride.';
    const error: SessionError = {
      code: 'partner-ended',
      message,
      recoverable: false,
      at: this.deps.clock.now(),
    };
    detach(this.requestShutdown({ error, byLocalUser: false, bye: null }));
  }

  private localPeerState(): PeerStateMessage {
    const s = this.snapshot;
    return {
      type: 'peer-state',
      name: this.deviceName,
      muted: s.muted,
      headsetConnected: s.local.headsetConnected,
      batteryPct: s.local.batteryPct,
      charging: this.charging,
      interruption: s.local.interruption,
    };
  }

  // ---- the start sequence -----------------------------------------------------------------------------

  private async startResources(): Promise<void> {
    const options = this.requireOptions();
    await this.ensurePermissions(options);
    await this.startAudio(options);
    await this.startService();
    await this.startMedia();
  }

  /**
   * One step of the start sequence: stops waiting as soon as shutdown is requested, maps a failure to a fatal
   * `Failure`, and (when `timeoutMs` is given) fails instead of hanging if a native call never answers.
   */
  private async runStep<T>(
    fn: () => PromiseLike<T> | T,
    options: { map: (error: unknown) => Failure; timeoutMs?: number; timeoutFailure?: Failure },
  ): Promise<T> {
    const { clock } = this.deps;
    const timeoutScope = new Scope<'timeout'>();
    const timer =
      options.timeoutMs === undefined
        ? null
        : clock.setTimeout(() => timeoutScope.cancel('timeout'), options.timeoutMs);
    try {
      return await this.rideScope.run(() => timeoutScope.run(fn));
    } catch (error) {
      if (error instanceof ScopeCancelled) {
        if (error.reason === 'timeout') {
          throw new FatalFailure(options.timeoutFailure ?? options.map(new Error('timed out')));
        }
        throw error;
      }
      if (error instanceof FatalFailure) throw error;
      throw new FatalFailure(options.map(error));
    } finally {
      if (timer !== null) clock.clearTimeout(timer);
    }
  }

  private async ensurePermissions(options: SessionStartOptions): Promise<void> {
    const { permissions } = this.deps;
    // The headset (Bluetooth) permission is only needed when a headset is required.
    const required: PermissionKey[] = options.allowNoHeadset ? ['microphone'] : ['microphone', 'bluetooth'];
    const failed = (error: unknown): Failure => ({
      code: 'permission-denied',
      message: 'Could not check the permissions.',
      recoverable: false,
      detail: describeError(error),
    });
    const missing = (status: PermissionStatus): PermissionKey[] =>
      required.filter((key) => status[key] !== 'granted' && status[key] !== 'unavailable');

    let status = await this.runStep(() => permissions.check(), { map: failed });
    const askable = missing(status).filter(
      (key) => status[key] === 'denied' || status[key] === 'undetermined',
    );
    if (askable.length > 0) {
      // Ask once for everything missing; notifications ride along when they were never asked.
      const extra: PermissionKey[] = status.notifications === 'undetermined' ? ['notifications'] : [];
      status = await this.runStep(() => permissions.request([...askable, ...extra]), { map: failed });
    }

    const stillMissing = missing(status);
    if (stillMissing.length > 0) {
      const blocked = stillMissing.some((key) => status[key] === 'blocked');
      const names = stillMissing.map((key) => PERMISSION_LABELS[key]).join(' and ');
      throw new FatalFailure({
        code: 'permission-denied',
        message: blocked
          ? `${names} permission is blocked. Allow it in the system settings.`
          : `${names} permission was denied.`,
        recoverable: false,
      });
    }
    if (status.notifications === 'undetermined') {
      // The foreground-service notification should be visible, but a refusal never blocks a ride.
      try {
        await this.runStep(() => permissions.request(['notifications']), { map: failed });
      } catch (error) {
        if (error instanceof ScopeCancelled) throw error;
        this.log('debug', 'notification permission request failed');
      }
    }
  }

  private async startAudio(options: SessionStartOptions): Promise<void> {
    const { audio } = this.deps;
    const state = await this.runStep(
      () => {
        const started = callAsync(() =>
          audio.start({ allowFallbackDevice: options.allowNoHeadset === true }),
        );
        this.audioStart = started;
        detach(started);
        return started;
      },
      {
        timeoutMs: INTERNAL_TIMINGS.startStepTimeoutMs,
        timeoutFailure: {
          code: 'audio-route-failed',
          message: 'The audio route did not start in time.',
          recoverable: false,
        },
        map: (error) => ({
          code: 'audio-route-failed',
          message: 'Could not switch to call audio.',
          recoverable: false,
          detail: describeError(error),
        }),
      },
    );
    const needsHeadset = options.allowNoHeadset !== true;
    if (state.status === 'no-headset' || (needsHeadset && state.status === 'active' && state.usingFallback)) {
      throw new FatalFailure({
        code: 'no-headset',
        message: 'No headset is connected. Connect your earbuds and start again.',
        recoverable: false,
      });
    }
    if (state.status !== 'active') {
      throw new FatalFailure({
        code: 'audio-route-failed',
        message: 'Could not switch to call audio.',
        recoverable: false,
        detail: state.error ?? state.status,
      });
    }
    this.applyAudioState(state);
    this.audioOff = audio.onChange((next) => this.onAudioChange(next));
  }

  /**
   * The headset flag and the interruption derived from it follow the audio route. (Phone calls and the cues and
   * behaviour around interruptions are M3; here the partner is only told, through peer-state.)
   */
  private applyAudioState(state: AudioRouteState): boolean {
    return this.patchLocal({
      headsetConnected: state.headsetConnected,
      interruption: state.status === 'no-headset' ? 'headset-disconnected' : 'none',
    });
  }

  private onAudioChange(state: AudioRouteState): void {
    if (this.stopRequested || this.finished) return;
    if (this.applyAudioState(state)) this.currentAttempt?.sendPeerState();
  }

  private async startService(): Promise<void> {
    const { service } = this.deps;
    const notification = this.currentNotification();
    this.lastNotification = JSON.stringify(notification);
    await this.runStep(
      () => {
        const started = callAsync(() =>
          service.start({ channelId: RIDE_CHANNEL_ID, channelName: RIDE_CHANNEL_NAME, notification }),
        );
        this.serviceStart = started;
        detach(started);
        return started;
      },
      {
        timeoutMs: INTERNAL_TIMINGS.startStepTimeoutMs,
        timeoutFailure: {
          code: 'service-failed',
          message: 'The ride service did not start in time.',
          recoverable: false,
        },
        map: (error) => ({
          code: 'service-failed',
          message: 'Could not start the ride service.',
          recoverable: false,
          detail: describeError(error),
        }),
      },
    );
    this.serviceReady = true;
    this.serviceOff = service.onAction((action) => this.onServiceAction(action));
    await this.refreshBattery();
    this.scheduleBatteryPoll();
    // The user may have muted while the service was starting.
    this.refreshNotification();
  }

  private async startMedia(): Promise<void> {
    const { media } = this.deps;
    await this.runStep(
      () => {
        const started = callAsync(() =>
          media.start({ tunables: this.deps.getTunables(), startMuted: this.snapshot.muted }),
        );
        this.mediaStart = started;
        detach(started);
        return started;
      },
      {
        timeoutMs: INTERNAL_TIMINGS.startStepTimeoutMs,
        timeoutFailure: {
          code: 'media-failed',
          message: 'The microphone did not start in time.',
          recoverable: false,
        },
        map: failureFromMediaStartError,
      },
    );
    this.mediaReady = true;
    try {
      media.setMuted(this.snapshot.muted); // the user may have toggled mute during the start sequence
    } catch (error) {
      this.log('warn', 'media.setMuted failed', { error: describeError(error) });
    }
  }

  private onServiceAction(action: RideServiceAction): void {
    if (this.stopRequested || this.finished) return;
    if (action === 'toggle-mute') {
      this.setMuted(!this.snapshot.muted);
    } else if (action === 'end') {
      detach(this.end());
    }
  }

  // ---- battery ----------------------------------------------------------------------------------------

  private async refreshBattery(): Promise<boolean> {
    const result = await settleCall(this.deps.clock, () => this.deps.service.getBattery(), 2_000);
    if (result.status !== 'fulfilled') return false;
    const info = result.value;
    const level = info ? Math.min(100, Math.max(0, Math.round(info.levelPct))) : null;
    const charging = info ? info.charging : null;
    const changed = charging !== this.charging;
    this.charging = charging;
    return this.patchLocal({ batteryPct: Number.isFinite(level) ? level : null }) || changed;
  }

  private scheduleBatteryPoll(): void {
    if (this.stopRequested || this.finished) return;
    this.batteryTimer = this.deps.clock.setTimeout(() => {
      this.batteryTimer = null;
      void this.pollBattery();
    }, INTERNAL_TIMINGS.batteryPollMs);
  }

  private async pollBattery(): Promise<void> {
    const changed = await this.refreshBattery();
    if (this.stopRequested || this.finished) return;
    if (changed) this.currentAttempt?.sendPeerState();
    this.scheduleBatteryPoll();
  }

  // ---- snapshot ---------------------------------------------------------------------------------------

  private toSessionError(failure: Failure): SessionError {
    return {
      code: failure.code,
      message: failure.message,
      recoverable: failure.recoverable,
      at: this.deps.clock.now(),
    };
  }

  private patchLocal(changes: Partial<SessionSnapshot['local']>): boolean {
    const prev = this.snapshot.local;
    const next = { ...prev, ...changes };
    if (
      next.headsetConnected === prev.headsetConnected &&
      next.interruption === prev.interruption &&
      next.batteryPct === prev.batteryPct
    ) {
      return false;
    }
    this.patch({ local: next });
    return true;
  }

  private patch(changes: Partial<SessionSnapshot>): void {
    if (this.finished) return;
    const prev = this.snapshot;
    let changed = false;
    for (const key of Object.keys(changes) as (keyof SessionSnapshot)[]) {
      if (!Object.is(prev[key], changes[key])) {
        changed = true;
        break;
      }
    }
    if (!changed) return;
    const next: SessionSnapshot = { ...prev, ...changes };
    this.snapshot = next;
    if (prev.state !== next.state) {
      this.log('info', `state ${prev.state} -> ${next.state}`, {
        from: prev.state,
        to: next.state,
        attempt: next.attempt,
        generation: next.generation,
      });
    }
    this.afterChange(prev, next);
    this.emit();
  }

  private afterChange(prev: SessionSnapshot, next: SessionSnapshot): void {
    if (prev.state !== next.state) {
      const cue = cueForTransition(prev.state, next.state, false);
      if (cue !== null) this.playCue(cue);
    }
    if (prev.state !== next.state || prev.muted !== next.muted || prev.peer?.name !== next.peer?.name) {
      this.refreshNotification();
    }
  }

  private emit(): void {
    const snapshot = this.snapshot;
    for (const listener of [...this.listeners]) {
      try {
        listener(snapshot);
      } catch (error) {
        this.log('warn', 'a snapshot listener threw', { error: describeError(error) });
      }
    }
  }

  // ---- cues and notification --------------------------------------------------------------------------

  /** Fire and forget: a cue never blocks a transition and a failing audio route never breaks the ride. */
  private playCue(cue: CueKind): void {
    if (this.audioStart === null) return;
    try {
      detach(this.deps.audio.playCue(cue), (error) => {
        this.log('debug', 'cue failed', { cue, error: describeError(error) });
      });
    } catch (error) {
      this.log('debug', 'cue failed', { cue, error: describeError(error) });
    }
  }

  private currentNotification(): ReturnType<typeof buildRideNotification> {
    return buildRideNotification({
      state: this.snapshot.state,
      muted: this.snapshot.muted,
      peerName: this.snapshot.peer?.name ?? null,
    });
  }

  private refreshNotification(): void {
    if (!this.serviceReady || this.finished || this.stopRequested) return;
    const notification = this.currentNotification();
    const key = JSON.stringify(notification);
    if (key === this.lastNotification) return;
    this.lastNotification = key;
    const { clock, service } = this.deps;
    // Serialised, so a slow update can never be overtaken by a newer one.
    this.notificationChain = this.notificationChain
      .then(() => settleCall(clock, () => service.update(notification), INTERNAL_TIMINGS.releaseTimeoutMs))
      .then((result) => {
        if (result.status !== 'fulfilled') {
          this.log('debug', 'service.update did not complete', { outcome: result.status });
        }
      })
      .catch(() => undefined);
  }

  // ---- shutdown ---------------------------------------------------------------------------------------

  private requestShutdown(outcome: ShutdownOutcome): Promise<void> {
    if (this.shutdownPromise) return this.shutdownPromise;
    this.stopRequested = true;
    this.rideScope.cancel('shutdown');
    this.shutdownPromise = this.doShutdown(outcome);
    return this.shutdownPromise;
  }

  private async doShutdown(outcome: ShutdownOutcome): Promise<void> {
    const { clock } = this.deps;
    try {
      // 1. Stop the connection attempt, telling the partner first when the user ended the ride.
      const attempt = this.currentAttempt;
      if (attempt) await attempt.cancel(outcome.bye ? { bye: outcome.bye } : undefined);
      // 2. Let the ride loop unwind (it exits at its next checkpoint).
      if (this.loopPromise) await settleWithin(clock, this.loopPromise, INTERNAL_TIMINGS.releaseTimeoutMs);
      // 3. A last cue, before the audio route that plays it is released.
      const cue = cueForTransition(this.snapshot.state, 'ended', outcome.byLocalUser);
      if (cue !== null && this.audioStart !== null) {
        await settleCall(clock, () => this.deps.audio.playCue(cue), INTERNAL_TIMINGS.cueGraceMs);
      }
    } catch (error) {
      this.log('warn', 'a shutdown step failed', { error: describeError(error) });
    } finally {
      try {
        await this.releaseAll();
      } catch (error) {
        this.log('error', 'releasing resources failed', { error: describeError(error) });
      }
      this.publishEnded(outcome.error);
    }
  }

  private async releaseAll(): Promise<void> {
    const { clock } = this.deps;
    for (const off of [this.audioOff, this.serviceOff]) {
      try {
        off?.();
      } catch {
        // an unsubscribe must not stop the release of everything else
      }
    }
    this.audioOff = null;
    this.serviceOff = null;
    if (this.batteryTimer !== null) {
      clock.clearTimeout(this.batteryTimer);
      this.batteryTimer = null;
    }
    if (this.mediaStart) await this.releaseOne('microphone', this.mediaStart, () => this.deps.media.stop());
    if (this.serviceStart)
      await this.releaseOne('ride service', this.serviceStart, () => this.deps.service.stop());
    if (this.audioStart) await this.releaseOne('audio route', this.audioStart, () => this.deps.audio.stop());
    await this.releaseOne('link', null, () => this.deps.link.dispose());
    this.secret?.fill(0);
  }

  /** Stops one resource; a start that is still in flight finishes first so stop() never races it. */
  private async releaseOne(
    what: string,
    inflight: Promise<unknown> | null,
    stop: () => PromiseLike<void> | void,
  ): Promise<void> {
    const { clock } = this.deps;
    const limit = INTERNAL_TIMINGS.releaseTimeoutMs;
    if (inflight) await settleWithin(clock, inflight, limit);
    const result = await settleCall(clock, stop, limit);
    if (result.status !== 'fulfilled') {
      this.log('warn', `releasing the ${what} did not complete cleanly`, {
        outcome: result.status,
        error: result.status === 'rejected' ? describeError(result.error) : undefined,
      });
    }
  }

  private publishEnded(error: SessionError | null): void {
    if (this.finished) return;
    const prev = this.snapshot;
    this.snapshot = { ...prev, state: 'ended', error, connectedAt: null };
    this.finished = true;
    this.log('info', `state ${prev.state} -> ended`, {
      from: prev.state,
      to: 'ended',
      code: error?.code,
    });
    this.emit();
  }

  // ---- logging ----------------------------------------------------------------------------------------

  /** Everything logged passes the scrubber first; a broken logger never breaks the ride. */
  private log(level: LogLevel, message: string, data?: LogData): void {
    try {
      let safe: LogData | undefined;
      if (data) {
        safe = {};
        for (const [key, value] of Object.entries(data)) {
          safe[key] = typeof value === 'string' ? this.scrub(value) : value;
        }
      }
      this.deps.logger.log(level, 'session', this.scrub(message), safe);
    } catch {
      // logging must never influence the ride
    }
  }
}

export function createSessionController(deps: SessionDeps): SessionControllerWithStats {
  return new SessionControllerImpl(deps);
}
