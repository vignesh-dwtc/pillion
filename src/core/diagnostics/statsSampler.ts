import type { Clock, TimerHandle } from '../common/types';
import type { MediaStats } from '../../platform/media/MediaEngine';
import type { StatsSample } from './types';

/**
 * Turns the media engine's cumulative counters into the rates the diagnostics screen shows.
 *
 *   bitrate (kbit/s) = delta bytes * 8 / delta ms      (1 bit per ms is exactly 1 kbit/s)
 *   loss (%)         = delta lost / (delta received + delta lost) * 100, null when nothing arrived or was lost
 *   rtt, jitter, levels pass through (rtt falls back to the selected candidate pair's)
 *
 * Counters restart from zero whenever a new media session starts (every reconnect). A counter that went backwards
 * therefore means "new session": that interval has no meaningful rate, so its rates are null and the next sample
 * starts from the new baseline. The first sample, a zero or negative time step, and non-finite input behave the
 * same way. Pure and deterministic: time comes from `MediaStats.timestamp`.
 */

function finiteOrNull(value: number | null | undefined): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function countersWentBackwards(previous: MediaStats, current: MediaStats): boolean {
  return (
    current.bytesSent < previous.bytesSent ||
    current.bytesReceived < previous.bytesReceived ||
    current.packetsSent < previous.packetsSent ||
    current.packetsReceived < previous.packetsReceived ||
    current.packetsLost < previous.packetsLost
  );
}

/** The rates between two cumulative snapshots (`previous` null means "no baseline yet"). */
export function computeStatsSample(previous: MediaStats | null, current: MediaStats): StatsSample {
  const base: StatsSample = {
    t: current.timestamp,
    rttMs: finiteOrNull(current.rttMs) ?? finiteOrNull(current.selectedPair?.rttMs),
    jitterMs: finiteOrNull(current.jitterMs),
    lossPct: null,
    bitrateOutKbps: null,
    bitrateInKbps: null,
    inputLevel: finiteOrNull(current.inputLevel),
    outputLevel: finiteOrNull(current.outputLevel),
  };
  if (!previous) return base;
  const elapsedMs = current.timestamp - previous.timestamp;
  if (!(elapsedMs > 0) || !Number.isFinite(elapsedMs)) return base;
  if (countersWentBackwards(previous, current)) return base;

  const bytesOut = current.bytesSent - previous.bytesSent;
  const bytesIn = current.bytesReceived - previous.bytesReceived;
  const received = current.packetsReceived - previous.packetsReceived;
  const lost = current.packetsLost - previous.packetsLost;
  const expected = received + lost;
  return {
    ...base,
    bitrateOutKbps: finiteOrNull((bytesOut * 8) / elapsedMs),
    bitrateInKbps: finiteOrNull((bytesIn * 8) / elapsedMs),
    lossPct: expected > 0 ? finiteOrNull((lost / expected) * 100) : null,
  };
}

export interface StatsSampler {
  /** Feeds the latest cumulative stats and returns the sample for the interval since the previous call. */
  sample(stats: MediaStats): StatsSample;
  /** Forgets the baseline (the media session ended): the next sample has no rates. */
  reset(): void;
  readonly last: StatsSample | null;
}

export function createStatsSampler(): StatsSampler {
  let previous: MediaStats | null = null;
  let last: StatsSample | null = null;
  return {
    sample(stats: MediaStats): StatsSample {
      const sample = computeStatsSample(previous, stats);
      previous = stats;
      last = sample;
      return sample;
    },
    reset(): void {
      previous = null;
      last = null;
    },
    get last(): StatsSample | null {
      return last;
    },
  };
}

export interface StatsPollerOptions {
  /** Where the cumulative stats come from; null means "no media session right now" (for example `controller.getMediaStats`). */
  source: () => Promise<MediaStats | null>;
  clock: Clock;
  /** Sampling period. Default 1000 ms. */
  intervalMs?: number;
  /** Called with each new sample, or null when there is no session or the source failed. */
  onSample: (sample: StatsSample | null, stats: MediaStats | null) => void;
}

/**
 * Polls `source` on the injected clock and feeds a sampler. One poll at a time (a slow source is never overlapped),
 * a failing or empty source yields a null sample and a fresh baseline. `stop()` is final and idempotent.
 */
export function createStatsPoller(options: StatsPollerOptions): { stop(): void } {
  const intervalMs = Math.max(1, options.intervalMs ?? 1000);
  const sampler = createStatsSampler();
  let stopped = false;
  let timer: TimerHandle | null = null;

  const schedule = (): void => {
    if (stopped) return;
    timer = options.clock.setTimeout(() => {
      timer = null;
      void poll();
    }, intervalMs);
  };

  const poll = async (): Promise<void> => {
    let stats: MediaStats | null = null;
    try {
      stats = await options.source();
    } catch {
      stats = null;
    }
    if (stopped) return;
    let sample: StatsSample | null = null;
    if (stats) {
      sample = sampler.sample(stats);
    } else {
      sampler.reset();
    }
    try {
      options.onSample(sample, stats);
    } catch {
      // a consumer's bug must not stop the sampling
    }
    schedule();
  };

  schedule();
  return {
    stop(): void {
      stopped = true;
      if (timer !== null) {
        options.clock.clearTimeout(timer);
        timer = null;
      }
    },
  };
}
