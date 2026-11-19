import type { LinkChannel, LinkEndpoint, LinkRole, LinkTransport } from '../../platform/link/LinkTransport';
import type {
  IceCandidateInit,
  MediaConnectionState,
  MediaEngine,
  MediaSession,
  MediaStats,
} from '../../platform/media/MediaEngine';
import type { Clock, LogData, TimerHandle, Unsubscribe } from '../common/types';
import type { CryptoProvider } from '../protocol/crypto';
import type {
  ByeReason,
  IceMessage,
  PeerStateMessage,
  SdpMessage,
  SessionMessage,
} from '../protocol/messages';
import type { EstablishSecureChannel, SecureChannel } from '../protocol/secureChannel';
import { Deferred, Scope, ScopeCancelled, detach, settleCall } from './async';
import { INTERNAL_TIMINGS } from './config';
import {
  FAILURES,
  describeError,
  failureFromCloseReason,
  failureFromLinkError,
  failureFromMediaError,
  failureFromProtocolError,
  type Failure,
} from './errors';
import { isValidGeneration, isValidSdpText, parseIceCandidate } from './inbound';
import type { SessionConfig } from './types';

/**
 * One negotiation attempt: open the link, run the secure handshake, exchange peer state, negotiate SDP/ICE, wait for
 * the media path, then keep the link alive with heartbeats until something fails or the attempt is cancelled.
 *
 * Everything that can go wrong funnels into `fail()` (first failure wins); every step races the attempt's `Scope`,
 * so a failure or cancellation unwinds whatever step is in flight, even a native call that never settles. A
 * `ConnectionAttempt` is single-use: the controller creates a fresh one (fresh link, fresh secure channel, fresh
 * media session) for every try, which is what makes recovery the same code path as the first connection.
 *
 * Signaling order (the first authenticated message is the guest's, so nothing depends on the secure channel
 * buffering messages that arrive before the first `onMessage` subscription):
 *   guest -> host   peer-state
 *   host  -> guest  peer-state
 *   host  -> guest  sdp offer (generation g), ice...
 *   guest -> host   sdp answer (generation g), ice...
 * `generation` is assigned by the host (one per negotiation) and adopted by the guest; sdp/ice messages carrying
 * any other generation are dropped as stale.
 */

export type AttemptPhase = 'linking' | 'signaling' | 'connecting';

export type AttemptEnd =
  { kind: 'failed'; failure: Failure; wasConnected: boolean } | { kind: 'cancelled'; wasConnected: boolean };

type EndReason = { kind: 'failed'; failure: Failure } | { kind: 'cancelled' };

/** What the attempt reports to (and asks of) the controller that owns it. */
export interface AttemptHooks {
  phase(phase: AttemptPhase): void;
  linkOpened(endpoint: LinkEndpoint): void;
  localPeerState(): PeerStateMessage;
  /** The partner's raw peer-state (the controller sanitizes it). */
  peerState(message: PeerStateMessage): void;
  /** Host: allocates and publishes the next negotiation generation. */
  nextGeneration(): number;
  /** Guest: adopts the generation of the host's offer. */
  adoptGeneration(generation: number): void;
  isMuted(): boolean;
  /** The media path is up. */
  connected(): void;
  /** Called synchronously, once, when the attempt first fails. */
  failed(failure: Failure, wasConnected: boolean): void;
  /** An authenticated `bye` arrived: the partner ended the ride. */
  bye(reason: ByeReason): void;
}

export interface AttemptEnv {
  role: LinkRole;
  pairId: string;
  wifiDirect: { networkName: string; passphrase: string } | undefined;
  /** Decoded pairing secret; the handshake receives a copy. */
  secret: Uint8Array;
  link: LinkTransport;
  media: MediaEngine;
  crypto: CryptoProvider;
  clock: Clock;
  config: SessionConfig;
  establish: EstablishSecureChannel;
  hooks: AttemptHooks;
  log: (level: 'debug' | 'info' | 'warn', message: string, data?: LogData) => void;
}

const STATS_TIMEOUT_MS = 1_000;

export class ConnectionAttempt {
  private readonly scope = new Scope<EndReason>();
  private done: Promise<AttemptEnd> | null = null;

  private readonly timers = new Set<TimerHandle>();
  private readonly offs: Unsubscribe[] = [];
  private pingTimer: TimerHandle | null = null;
  private watchdogTimer: TimerHandle | null = null;
  private mediaGraceTimer: TimerHandle | null = null;
  private signalingOff: (() => void) | null = null;
  private negotiationOff: (() => void) | null = null;

  private channel: LinkChannel | null = null;
  private secure: SecureChannel | null = null;
  private session: MediaSession | null = null;
  private sessionPromise: Promise<MediaSession> | null = null;
  private abortOpen: (() => void) | null = null;

  private sendChain: Promise<void> = Promise.resolve();
  private signalChain: Promise<void> = Promise.resolve();

  private readonly peerStateSeen = new Deferred<void>();
  private readonly sdpComplete = new Deferred<void>();
  private readonly mediaConnected = new Deferred<void>();

  private generation = 0;
  private localStateSent = false;
  private offerQueued = false;
  private offerSeen = false;
  private answerSeen = false;
  private remoteDescriptionApplied = false;
  private sdpQueued = false;
  private pendingCandidates: (IceCandidateInit | null)[] = [];

  private mediaEverConnected = false;
  private connected = false;
  private disposing = false;
  private byeQueued = false;
  private pingId = 0;

  constructor(private readonly env: AttemptEnv) {}

  /** Runs the attempt. Resolves (never rejects) once it has ended and everything it opened has been released. */
  start(): Promise<AttemptEnd> {
    if (!this.done) this.done = this.execute();
    return this.done;
  }

  /**
   * Ends the attempt from outside (the ride is ending). With `bye`, tells the partner first (bounded wait) when
   * the secure channel is up. Resolves once the attempt has released everything.
   */
  async cancel(options?: { bye?: ByeReason }): Promise<void> {
    if (options?.bye && this.secure && !this.byeQueued && !this.scope.isCancelled) {
      this.byeQueued = true;
      const bye = options.bye;
      await settleCall(
        this.env.clock,
        () => this.send({ type: 'bye', reason: bye }),
        INTERNAL_TIMINGS.byeTimeoutMs,
      );
    }
    this.scope.cancel({ kind: 'cancelled' });
    await this.start();
  }

  /** Re-sends the local peer-state (mute, headset, battery changed). A no-op until the first one went out. */
  sendPeerState(): void {
    if (!this.localStateSent || !this.secure || this.scope.isCancelled) return;
    this.sendOrFail(this.env.hooks.localPeerState());
  }

  async getMediaStats(): Promise<MediaStats | null> {
    const session = this.session;
    if (!session || this.disposing) return null;
    const result = await settleCall(this.env.clock, () => session.getStats(), STATS_TIMEOUT_MS);
    return result.status === 'fulfilled' ? result.value : null;
  }

  // ---- the attempt ------------------------------------------------------------------------------------

  private async execute(): Promise<AttemptEnd> {
    let end: AttemptEnd;
    try {
      await this.openLink();
      await this.handshake();
      await this.exchangeState();
      await this.negotiate();
      this.enterConnected();
      const reason = await this.scope.whenCancelled;
      end = this.endFrom(reason);
    } catch (error) {
      end = this.endFromThrown(error);
    }
    // Whatever ended the attempt, nothing may react to lower-layer events from here on.
    this.scope.cancel({ kind: 'cancelled' });
    await this.dispose();
    return end;
  }

  private endFrom(reason: EndReason): AttemptEnd {
    return reason.kind === 'failed'
      ? { kind: 'failed', failure: reason.failure, wasConnected: this.connected }
      : { kind: 'cancelled', wasConnected: this.connected };
  }

  private endFromThrown(error: unknown): AttemptEnd {
    if (error instanceof ScopeCancelled) return this.endFrom(error.reason as EndReason);
    // Anything else is a bug in this module or a throwing adapter outside a guarded call: report it, retry.
    const failure: Failure = { ...FAILURES.unexpected, detail: describeError(error) };
    this.fail(failure);
    return { kind: 'failed', failure, wasConnected: this.connected };
  }

  /** First failure wins; later ones (the usual cascade of close events) are ignored. */
  private fail(failure: Failure): void {
    if (!this.scope.cancel({ kind: 'failed', failure })) return;
    try {
      this.env.hooks.failed(failure, this.connected);
    } catch (error) {
      this.env.log('warn', 'failure hook threw', { error: describeError(error) });
    }
  }

  /** Runs one async step against the attempt's scope, mapping a thrown error to a Failure. */
  private async guarded<T>(
    fn: () => PromiseLike<T> | T,
    map: (error: unknown) => Failure,
    onLate?: (value: T) => void,
  ): Promise<T> {
    try {
      return await this.scope.run(fn, onLate);
    } catch (error) {
      if (error instanceof ScopeCancelled) throw error;
      const failure = map(error);
      this.fail(failure);
      throw new ScopeCancelled<EndReason>(this.scope.reason ?? { kind: 'failed', failure });
    }
  }

  private wait(deferred: Deferred<void>): Promise<void> {
    return this.scope.run(() => deferred.promise);
  }

  private armTimer(ms: number, fn: () => void): () => void {
    const handle = this.env.clock.setTimeout(() => {
      this.timers.delete(handle);
      if (this.scope.isCancelled) return;
      fn();
    }, ms);
    this.timers.add(handle);
    return () => {
      if (this.timers.delete(handle)) this.env.clock.clearTimeout(handle);
    };
  }

  // ---- linking ----------------------------------------------------------------------------------------

  private async openLink(): Promise<void> {
    const { link, role, pairId, wifiDirect, config } = this.env;
    this.env.hooks.phase('linking');
    const aborter = typeof AbortController === 'function' ? new AbortController() : null;
    this.abortOpen = () => aborter?.abort();
    const offCancel = this.scope.onCancel(() => aborter?.abort());
    const disarm = this.armTimer(config.linkOpenTimeoutMs + INTERNAL_TIMINGS.watchdogGraceMs, () => {
      // The transport promised its own deadline; it did not settle. Abort it and move on.
      aborter?.abort();
      this.fail(FAILURES.linkOpenTimeout);
    });
    let channel: LinkChannel;
    try {
      channel = await this.guarded(
        () =>
          link.open({
            role,
            pairId,
            wifiDirect,
            timeoutMs: config.linkOpenTimeoutMs,
            signal: aborter?.signal,
          }),
        failureFromLinkError,
        (late) => this.closeQuietly('late link channel', () => late.close()),
      );
    } finally {
      disarm();
      offCancel();
    }
    this.channel = channel;
    this.env.hooks.linkOpened(channel.endpoint);
  }

  /**
   * Close events are only acted on once the handshake is done: while it runs, `establish` observes the closing
   * channel itself and rejects with the precise reason (a `reject` from the partner must classify as
   * auth-failed, not as the plain close that follows it). 'local-close' is never a failure: it is our own close()
   * (or the handshake's) echoing back, and whoever closed reports the reason.
   */
  private onLinkClosed(reason: string, detail?: string): void {
    if (this.scope.isCancelled || reason === 'local-close') return;
    this.fail(failureFromCloseReason(reason, detail));
  }

  // ---- handshake --------------------------------------------------------------------------------------

  private async handshake(): Promise<void> {
    const { role, pairId, crypto, clock, config } = this.env;
    const channel = this.channel;
    if (!channel) throw new Error('handshake without a link channel');
    this.env.hooks.phase('signaling');
    const disarm = this.armTimer(config.handshakeTimeoutMs + INTERNAL_TIMINGS.watchdogGraceMs, () => {
      this.fail({
        code: 'link-unavailable',
        message: 'Your partner did not answer in time.',
        recoverable: true,
        detail: 'handshake watchdog',
      });
    });
    let secure: SecureChannel;
    try {
      secure = await this.guarded(
        () =>
          this.env.establish(channel, {
            role,
            pairId,
            // A copy: the handshake may wipe what it is given, and the next attempt needs the secret again.
            secret: this.env.secret.slice(),
            crypto,
            handshakeTimeoutMs: config.handshakeTimeoutMs,
            setTimeout: (fn, ms) => clock.setTimeout(fn, ms),
            clearTimeout: (handle) => clock.clearTimeout(handle),
          }),
        failureFromProtocolError,
        (late) => this.closeQuietly('late secure channel', () => late.close()),
      );
    } finally {
      disarm();
    }
    this.secure = secure;
    // Subscribe in the same turn the handshake resolved, before anything else can run.
    this.offs.push(secure.onClose((reason) => this.onSecureClosed(reason)));
    this.offs.push(secure.onMessage((message) => this.onMessage(message)));
    this.offs.push(channel.onClose((reason, detail) => this.onLinkClosed(reason, detail)));
    this.startMediaSession();
  }

  private onSecureClosed(reason: string): void {
    if (this.scope.isCancelled || reason === 'local-close') return;
    this.fail(failureFromCloseReason(reason));
  }

  // ---- peer state -------------------------------------------------------------------------------------

  private async exchangeState(): Promise<void> {
    this.signalingOff = this.armTimer(this.env.config.handshakeTimeoutMs, () => {
      this.fail(FAILURES.signalingTimeout);
    });
    if (this.env.role === 'guest') {
      // The guest speaks first (see the header comment), then waits for the host's state.
      await this.sendLocalState();
      await this.wait(this.peerStateSeen);
    } else {
      await this.wait(this.peerStateSeen);
      await this.sendLocalState();
    }
  }

  private async sendLocalState(): Promise<void> {
    const sent = this.send(this.env.hooks.localPeerState());
    this.localStateSent = true;
    await this.guarded(() => sent, failureFromProtocolError);
  }

  // ---- negotiation ------------------------------------------------------------------------------------

  private startMediaSession(): void {
    const { media } = this.env;
    const created = this.guarded(
      () => media.createSession(),
      failureFromMediaError,
      (late) => this.closeQuietly('late media session', () => late.close()),
    ).then((session) => {
      if (this.disposing) {
        // The attempt ended between creation and here; dispose() has already run past the session.
        this.closeQuietly('media session of a finished attempt', () => session.close());
        throw new ScopeCancelled<EndReason>({ kind: 'cancelled' });
      }
      this.session = session;
      this.offs.push(session.onState((state) => this.onMediaState(state)));
      this.offs.push(session.onLocalCandidate((candidate) => this.onLocalCandidate(candidate)));
      try {
        // A fresh session must follow the current mute state (the engine keeps one microphone per ride).
        media.setMuted(this.env.hooks.isMuted());
      } catch (error) {
        this.env.log('warn', 'media.setMuted failed', { error: describeError(error) });
      }
      return session;
    });
    this.sessionPromise = created;
    // Failures are already routed through fail(); this only keeps the rejection from being unhandled.
    detach(created);
  }

  private async negotiate(): Promise<void> {
    const pending = this.sessionPromise;
    if (!pending) throw new Error('negotiation without a media session');
    const session = await pending;
    if (this.env.role === 'host') {
      const generation = this.env.hooks.nextGeneration();
      this.generation = generation;
      this.disarmSignaling();
      this.armNegotiation();
      const offer = await this.guarded(() => session.createOffer(), failureFromMediaError);
      const sent = this.send({ type: 'sdp', generation, kind: 'offer', sdp: offer.sdp });
      // Queued behind the offer: candidates can never overtake it, whatever the order of events.
      this.offerQueued = true;
      this.sdpQueued = true;
      this.flushCandidates();
      await this.guarded(() => sent, failureFromProtocolError);
    }
    await this.wait(this.sdpComplete);
    this.env.hooks.phase('connecting');
    await this.wait(this.mediaConnected);
    this.disarmNegotiation();
  }

  private disarmSignaling(): void {
    this.signalingOff?.();
    this.signalingOff = null;
  }

  private armNegotiation(): void {
    if (this.negotiationOff) return;
    this.negotiationOff = this.armTimer(this.env.config.negotiationTimeoutMs, () => {
      this.fail(FAILURES.negotiationTimeout);
    });
  }

  private disarmNegotiation(): void {
    this.negotiationOff?.();
    this.negotiationOff = null;
  }

  private onLocalCandidate(candidate: IceCandidateInit | null): void {
    if (this.scope.isCancelled) return;
    this.pendingCandidates.push(candidate);
    if (this.sdpQueued) this.flushCandidates();
  }

  private flushCandidates(): void {
    const generation = this.generation;
    const batch = this.pendingCandidates;
    this.pendingCandidates = [];
    for (const candidate of batch) {
      this.sendOrFail({ type: 'ice', generation, candidate });
    }
  }

  private onMediaState(state: MediaConnectionState): void {
    if (this.scope.isCancelled) return;
    switch (state) {
      case 'connected':
        this.mediaEverConnected = true;
        this.clearMediaGrace();
        this.mediaConnected.resolve();
        break;
      case 'disconnected':
        // ICE can heal by itself; give it the same patience as a silent link before tearing down.
        if (this.mediaEverConnected && this.mediaGraceTimer === null) {
          this.mediaGraceTimer = this.env.clock.setTimeout(() => {
            this.mediaGraceTimer = null;
            if (!this.scope.isCancelled) this.fail(FAILURES.mediaLost);
          }, this.env.config.heartbeatTimeoutMs);
        }
        break;
      case 'failed':
        this.fail(FAILURES.mediaFailed);
        break;
      case 'closed':
        // Only we close our session, and only while disposing; anything earlier is a failure.
        if (!this.disposing) this.fail(FAILURES.mediaLost);
        break;
      case 'new':
      case 'checking':
        break;
    }
  }

  private clearMediaGrace(): void {
    if (this.mediaGraceTimer !== null) {
      this.env.clock.clearTimeout(this.mediaGraceTimer);
      this.mediaGraceTimer = null;
    }
  }

  // ---- inbound messages -------------------------------------------------------------------------------

  private onMessage(message: SessionMessage): void {
    if (this.scope.isCancelled) return;
    // Any authenticated message proves the link is alive.
    if (this.connected) this.armWatchdog();
    switch (message.type) {
      case 'ping':
        this.sendOrFail({ type: 'pong', id: message.id, t: message.t });
        break;
      case 'pong':
        break;
      case 'peer-state':
        this.env.hooks.peerState(message);
        this.peerStateSeen.resolve();
        break;
      case 'bye':
        this.env.hooks.bye(message.reason);
        break;
      case 'ready':
        // The handshake's closing message; harmless if the secure channel hands it up.
        break;
      case 'sdp':
      case 'ice':
        this.enqueueSignal(message);
        break;
      default:
        this.env.log('debug', 'ignored unknown message type');
    }
  }

  /** Signaling is handled strictly in arrival order: a candidate must never be applied before its SDP. */
  private enqueueSignal(message: SdpMessage | IceMessage): void {
    const run = this.signalChain.then(async () => {
      if (this.scope.isCancelled) return;
      const pending = this.sessionPromise;
      if (!pending) return;
      const session = await pending;
      if (message.type === 'sdp') {
        await this.handleSdp(message, session);
      } else {
        await this.handleIce(message, session);
      }
    });
    this.signalChain = run.then(
      () => undefined,
      (error: unknown) => {
        if (error instanceof ScopeCancelled) return;
        this.fail({ ...FAILURES.unexpected, detail: describeError(error) });
      },
    );
  }

  private async handleSdp(message: SdpMessage, session: MediaSession): Promise<void> {
    if (!isValidGeneration(message.generation)) {
      this.env.log('warn', 'dropped sdp with an invalid generation');
      return;
    }
    if (this.env.role === 'guest' && message.kind === 'offer') {
      await this.handleOffer(message, session);
    } else if (this.env.role === 'host' && message.kind === 'answer') {
      await this.handleAnswer(message, session);
    } else {
      this.env.log('warn', 'dropped sdp of the wrong kind for this role', { kind: message.kind });
    }
  }

  private async handleOffer(message: SdpMessage, session: MediaSession): Promise<void> {
    if (this.offerSeen) {
      this.env.log('debug', 'dropped a second offer on the same channel', { generation: message.generation });
      return;
    }
    if (!isValidSdpText(message.sdp)) {
      this.fail({ ...FAILURES.mediaFailed, detail: 'offer sdp malformed' });
      return;
    }
    this.offerSeen = true;
    // The host's generation is authoritative; the guest follows it, even if it is lower (host restarted).
    this.generation = message.generation;
    this.env.hooks.adoptGeneration(message.generation);
    this.disarmSignaling();
    this.armNegotiation();
    const answer = await this.guarded(
      () => session.acceptOffer({ type: 'offer', sdp: message.sdp }),
      failureFromMediaError,
    );
    this.remoteDescriptionApplied = true;
    const sent = this.send({ type: 'sdp', generation: this.generation, kind: 'answer', sdp: answer.sdp });
    this.sdpQueued = true;
    this.flushCandidates();
    await this.guarded(() => sent, failureFromProtocolError);
    this.sdpComplete.resolve();
  }

  private async handleAnswer(message: SdpMessage, session: MediaSession): Promise<void> {
    if (!this.offerQueued || message.generation !== this.generation) {
      this.env.log('debug', 'dropped a stale answer', {
        generation: message.generation,
        current: this.generation,
      });
      return;
    }
    if (this.answerSeen) {
      this.env.log('debug', 'dropped a second answer on the same channel');
      return;
    }
    if (!isValidSdpText(message.sdp)) {
      this.fail({ ...FAILURES.mediaFailed, detail: 'answer sdp malformed' });
      return;
    }
    this.answerSeen = true;
    await this.guarded(
      () => session.acceptAnswer({ type: 'answer', sdp: message.sdp }),
      failureFromMediaError,
    );
    this.remoteDescriptionApplied = true;
    this.sdpComplete.resolve();
  }

  private async handleIce(message: IceMessage, session: MediaSession): Promise<void> {
    if (this.generation === 0 || message.generation !== this.generation) {
      this.env.log('debug', 'dropped a stale candidate', {
        generation: message.generation,
        current: this.generation,
      });
      return;
    }
    if (!this.remoteDescriptionApplied) {
      this.env.log('debug', 'dropped a candidate that arrived before the remote description');
      return;
    }
    const candidate = parseIceCandidate(message.candidate);
    if (candidate === undefined) {
      this.env.log('warn', 'dropped a malformed candidate');
      return;
    }
    try {
      await this.scope.run(() => session.addRemoteCandidate(candidate));
    } catch (error) {
      if (error instanceof ScopeCancelled) throw error;
      // One unusable candidate does not end the attempt; the others may still connect.
      this.env.log('warn', 'addRemoteCandidate failed', { error: describeError(error) });
    }
  }

  // ---- connected --------------------------------------------------------------------------------------

  private enterConnected(): void {
    this.connected = true;
    this.armWatchdog();
    this.schedulePing();
    this.env.hooks.connected();
  }

  private schedulePing(): void {
    this.pingTimer = this.env.clock.setTimeout(() => {
      this.pingTimer = null;
      if (this.scope.isCancelled) return;
      this.pingId += 1;
      this.sendOrFail({ type: 'ping', id: this.pingId, t: this.env.clock.now() });
      this.schedulePing();
    }, this.env.config.heartbeatIntervalMs);
  }

  private armWatchdog(): void {
    if (this.watchdogTimer !== null) this.env.clock.clearTimeout(this.watchdogTimer);
    this.watchdogTimer = this.env.clock.setTimeout(() => {
      this.watchdogTimer = null;
      if (!this.scope.isCancelled) this.fail(FAILURES.heartbeatTimeout);
    }, this.env.config.heartbeatTimeoutMs);
  }

  // ---- sending ----------------------------------------------------------------------------------------

  /** Sends in call order, whatever the secure channel does internally. */
  private send(message: SessionMessage): Promise<void> {
    const secure = this.secure;
    if (!secure) return Promise.reject(new Error('secure channel not established'));
    const result = this.sendChain.then(() => secure.send(message));
    this.sendChain = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }

  private sendOrFail(message: SessionMessage): void {
    detach(this.send(message), (error) => {
      if (!this.scope.isCancelled) this.fail(failureFromProtocolError(error));
    });
  }

  // ---- teardown ---------------------------------------------------------------------------------------

  /** Closes something that arrived after the attempt had already ended. Never throws, never blocks. */
  private closeQuietly(what: string, fn: () => PromiseLike<void> | void): void {
    detach(
      settleCall(this.env.clock, fn, INTERNAL_TIMINGS.releaseTimeoutMs).then((result) => {
        this.logRelease(what, result);
      }),
    );
  }

  private async dispose(): Promise<void> {
    this.disposing = true;
    this.abortOpen?.();
    for (const handle of this.timers) this.env.clock.clearTimeout(handle);
    this.timers.clear();
    if (this.pingTimer !== null) this.env.clock.clearTimeout(this.pingTimer);
    if (this.watchdogTimer !== null) this.env.clock.clearTimeout(this.watchdogTimer);
    this.clearMediaGrace();
    this.pingTimer = null;
    this.watchdogTimer = null;
    for (const off of this.offs.splice(0)) {
      try {
        off();
      } catch {
        // an unsubscribe must not stop the release of everything else
      }
    }
    const { clock } = this.env;
    const limit = INTERNAL_TIMINGS.releaseTimeoutMs;
    const session = this.session;
    if (session) {
      const result = await settleCall(clock, () => session.close(), limit);
      this.logRelease('media session', result);
    }
    const secure = this.secure;
    if (secure) {
      const result = await settleCall(clock, () => secure.close(), limit);
      this.logRelease('secure channel', result);
    }
    const channel = this.channel;
    if (channel) {
      const result = await settleCall(clock, () => channel.close(), limit);
      this.logRelease('link channel', result);
    }
  }

  private logRelease(what: string, result: { status: string; error?: unknown }): void {
    if (result.status === 'fulfilled') return;
    this.env.log('warn', `closing the ${what} did not complete cleanly`, {
      outcome: result.status,
      error: result.status === 'rejected' ? describeError(result.error) : undefined,
    });
  }
}
