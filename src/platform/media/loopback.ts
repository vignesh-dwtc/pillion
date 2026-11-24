/**
 * Loopback self-test (brief, "Diagnostics"): plays my own microphone back through the headset over a local WebRTC
 * connection, so audio routing can be checked with one phone.
 *
 * Two sessions of ONE engine in one process, wired to each other in memory (no link, no signaling channel):
 *   sender    sendLocalAudio: true,  playRemoteAudio: false   (creates the offer)
 *   receiver  sendLocalAudio: false, playRemoteAudio: true    (answers; plays what the sender captures)
 * The offer/answer pass through the same Opus munging as a real ride, candidates are trickled both ways.
 *
 * Engine-agnostic (only the `MediaEngine` contract): the same code runs on the native engine and the web twin.
 * The test starts the engine it is given and always stops it, so pass a dedicated engine, never the ride's.
 * It only reads cumulative counters; no audio is recorded or stored.
 *
 * Pass criteria: the pair reaches `connected` within `connectTimeoutMs`, and by the end the sender sent and the
 * receiver received RTP bytes. Everything else (loss, jitter, levels, candidates) is reported, not judged.
 */
import { systemClock, type Clock, type TimerHandle } from '../../core/common/types';
import type { AudioTunables } from '../audio/AudioTunables';

import {
  MediaError,
  type MediaConnectionState,
  type MediaEngine,
  type MediaSession,
  type MediaStats,
} from './MediaEngine';

export interface LoopbackOptions {
  tunables: AudioTunables;
  /** How long to keep the loop running once connected. Default 10 000 ms. */
  durationMs?: number;
  /** Give up when the two sessions do not connect within this. Default 10 000 ms. */
  connectTimeoutMs?: number;
  /** Progress samples while running (for a live meter). Default 1 000 ms; 0 disables. */
  sampleIntervalMs?: number;
  onProgress?: (progress: LoopbackProgress) => void;
  clock?: Clock;
}

export interface LoopbackProgress {
  phase: LoopbackPhase;
  elapsedMs: number;
  sender: MediaStats | null;
  receiver: MediaStats | null;
}

export type LoopbackPhase = 'starting' | 'negotiating' | 'connecting' | 'running' | 'finished';

export type LoopbackFailure =
  | 'permission'
  | 'capture-failed'
  | 'negotiation-failed'
  | 'unsupported'
  | 'connect-timeout'
  | 'connection-failed'
  | 'no-audio'
  | 'cancelled'
  | 'error';

export interface LoopbackResult {
  ok: boolean;
  failure: LoopbackFailure | null;
  /** Short human-readable reason; never contains SDP or candidates. */
  message: string | null;
  /** From start() to the end of the test. */
  durationMs: number;
  /** From the first offer to `connected` on both sides; null if never connected. */
  connectMs: number | null;
  /** Final stats of each side (null if the side never existed or stats failed). */
  sender: MediaStats | null;
  receiver: MediaStats | null;
  bytesSent: number;
  bytesReceived: number;
  packetsLost: number;
}

export interface LoopbackRun {
  result: Promise<LoopbackResult>;
  /** Ends the test early; the result resolves with `failure: 'cancelled'` unless it already finished. */
  cancel(): void;
}

class LoopbackAbort extends Error {
  constructor(
    readonly failure: LoopbackFailure,
    message: string,
  ) {
    super(message);
    this.name = 'LoopbackAbort';
  }
}

function failureOf(error: unknown): { failure: LoopbackFailure; message: string } {
  if (error instanceof LoopbackAbort) return { failure: error.failure, message: error.message };
  if (error instanceof MediaError) {
    const failure: LoopbackFailure = error.code === 'closed' ? 'cancelled' : error.code;
    return { failure, message: error.message };
  }
  return { failure: 'error', message: error instanceof Error ? error.message : String(error) };
}

async function safeStats(session: MediaSession | null): Promise<MediaStats | null> {
  if (session === null) return null;
  try {
    return await session.getStats();
  } catch {
    return null;
  }
}

/** Starts the loopback self-test. `engine` is started and always stopped by the test. */
export function startLoopbackSelfTest(engine: MediaEngine, options: LoopbackOptions): LoopbackRun {
  const clock = options.clock ?? systemClock;
  const durationMs = Math.max(0, options.durationMs ?? 10_000);
  const connectTimeoutMs = Math.max(1, options.connectTimeoutMs ?? 10_000);
  const sampleIntervalMs = Math.max(0, options.sampleIntervalMs ?? 1_000);

  const timers = new Set<TimerHandle>();
  const offs: (() => void)[] = [];
  let sender: MediaSession | null = null;
  let receiver: MediaSession | null = null;
  let finished = false;
  let abort: ((error: LoopbackAbort) => void) | null = null;
  const aborted = new Promise<never>((_, reject) => {
    abort = (error) => reject(error);
  });
  aborted.catch(() => undefined);

  const startedAt = clock.now();
  const elapsed = () => clock.now() - startedAt;
  const sleep = (ms: number) =>
    new Promise<void>((resolve) => {
      const handle = clock.setTimeout(() => {
        timers.delete(handle);
        resolve();
      }, ms);
      timers.add(handle);
    });
  /** Races a step against cancellation / connection failure. */
  const step = <T>(promise: Promise<T>): Promise<T> => Promise.race([promise, aborted]);

  const progress = async (phase: LoopbackPhase, withStats: boolean) => {
    if (!options.onProgress) return;
    const [s, r] = withStats ? await Promise.all([safeStats(sender), safeStats(receiver)]) : [null, null];
    if (finished && phase !== 'finished') return;
    try {
      options.onProgress({ phase, elapsedMs: elapsed(), sender: s, receiver: r });
    } catch {
      // a throwing UI callback must not break the test
    }
  };

  const run = async (): Promise<LoopbackResult> => {
    let connectMs: number | null = null;
    let outcome: { failure: LoopbackFailure; message: string } | null = null;
    let senderStats: MediaStats | null = null;
    let receiverStats: MediaStats | null = null;
    try {
      void progress('starting', false);
      await step(engine.start({ tunables: options.tunables, startMuted: false }));
      sender = await step(engine.createSession({ sendLocalAudio: true, playRemoteAudio: false }));
      receiver = await step(engine.createSession({ sendLocalAudio: false, playRemoteAudio: true }));
      const a = sender;
      const b = receiver;

      const states: Record<'a' | 'b', MediaConnectionState> = { a: 'new', b: 'new' };
      let resolveConnected: () => void = () => undefined;
      const connected = new Promise<void>((resolve) => {
        resolveConnected = resolve;
      });
      const watch = (side: 'a' | 'b') => (state: MediaConnectionState) => {
        states[side] = state;
        if (state === 'failed' || state === 'closed') {
          abort?.(new LoopbackAbort('connection-failed', `${side === 'a' ? 'sender' : 'receiver'} ${state}`));
        }
        if (states.a === 'connected' && states.b === 'connected') resolveConnected();
      };
      offs.push(a.onState(watch('a')), b.onState(watch('b')));
      // Trickle ICE in memory. Errors on a single candidate are not fatal (the session swallows them anyway).
      offs.push(
        a.onLocalCandidate((candidate) => void b.addRemoteCandidate(candidate).catch(() => undefined)),
        b.onLocalCandidate((candidate) => void a.addRemoteCandidate(candidate).catch(() => undefined)),
      );

      void progress('negotiating', false);
      const negotiationStarted = clock.now();
      const offer = await step(a.createOffer());
      const answer = await step(b.acceptOffer(offer));
      await step(a.acceptAnswer(answer));

      void progress('connecting', false);
      const timeout = sleep(connectTimeoutMs).then(() => {
        throw new LoopbackAbort('connect-timeout', `not connected after ${connectTimeoutMs} ms`);
      });
      timeout.catch(() => undefined);
      await step(Promise.race([connected, timeout]));
      connectMs = clock.now() - negotiationStarted;

      const runUntil = clock.now() + durationMs;
      while (clock.now() < runUntil) {
        const wait =
          sampleIntervalMs > 0 ? Math.min(sampleIntervalMs, runUntil - clock.now()) : runUntil - clock.now();
        await step(sleep(Math.max(0, wait)));
        if (sampleIntervalMs > 0) await step(progress('running', true));
      }
    } catch (error) {
      outcome = failureOf(error);
    } finally {
      finished = true;
      senderStats = await safeStats(sender);
      receiverStats = await safeStats(receiver);
      for (const off of offs.splice(0)) off();
      for (const handle of timers) clock.clearTimeout(handle);
      timers.clear();
      try {
        await engine.stop(); // closes both sessions and releases the microphone
      } catch {
        // nothing else to release
      }
    }

    const bytesSent = senderStats?.bytesSent ?? 0;
    const bytesReceived = receiverStats?.bytesReceived ?? 0;
    if (outcome === null && (bytesSent === 0 || bytesReceived === 0)) {
      outcome = {
        failure: 'no-audio',
        message: `connected but no audio flowed (sent ${bytesSent} B, received ${bytesReceived} B)`,
      };
    }
    const result: LoopbackResult = {
      ok: outcome === null,
      failure: outcome?.failure ?? null,
      message: outcome?.message ?? null,
      durationMs: elapsed(),
      connectMs,
      sender: senderStats,
      receiver: receiverStats,
      bytesSent,
      bytesReceived,
      packetsLost: receiverStats?.packetsLost ?? 0,
    };
    void progress('finished', false);
    return result;
  };

  return {
    result: run(),
    cancel: () => {
      if (!finished) abort?.(new LoopbackAbort('cancelled', 'cancelled'));
    },
  };
}

/** Convenience: run to completion. */
export function runLoopbackSelfTest(engine: MediaEngine, options: LoopbackOptions): Promise<LoopbackResult> {
  return startLoopbackSelfTest(engine, options).result;
}
