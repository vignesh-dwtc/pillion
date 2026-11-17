import type { MediaStats } from '../../platform/media/MediaEngine';
import { ManualClock } from '../session/testing';
import { computeStatsSample, createStatsPoller, createStatsSampler } from './statsSampler';
import type { StatsSample } from './types';

function stats(overrides: Partial<MediaStats> = {}): MediaStats {
  return {
    timestamp: 0,
    connectionState: 'connected',
    selectedPair: null,
    localCandidates: [],
    remoteCandidates: [],
    rttMs: 20,
    jitterMs: 3,
    packetsSent: 0,
    packetsReceived: 0,
    packetsLost: 0,
    bytesSent: 0,
    bytesReceived: 0,
    inputLevel: 0.25,
    outputLevel: 0.5,
    codec: 'opus/48000/2',
    ...overrides,
  };
}

describe('computeStatsSample', () => {
  it('has no rates without a baseline but passes instantaneous values through', () => {
    const s = computeStatsSample(null, stats({ timestamp: 5 }));
    expect(s).toEqual({
      t: 5,
      rttMs: 20,
      jitterMs: 3,
      lossPct: null,
      bitrateOutKbps: null,
      bitrateInKbps: null,
      inputLevel: 0.25,
      outputLevel: 0.5,
    });
  });

  it('computes kbit/s and loss percent over the interval', () => {
    const a = stats({
      timestamp: 1000,
      bytesSent: 1000,
      bytesReceived: 2000,
      packetsReceived: 100,
      packetsLost: 0,
    });
    const b = stats({
      timestamp: 3000,
      bytesSent: 4000,
      bytesReceived: 3000,
      packetsReceived: 190,
      packetsLost: 10,
    });
    const s = computeStatsSample(a, b);
    expect(s.bitrateOutKbps).toBeCloseTo(12); // 3000 B * 8 / 2000 ms
    expect(s.bitrateInKbps).toBeCloseTo(4);
    expect(s.lossPct).toBeCloseTo(10); // 10 / (90 + 10)
  });

  it('reports zero loss when packets arrive and none are lost, null when nothing happened', () => {
    const a = stats({ timestamp: 0 });
    expect(computeStatsSample(a, stats({ timestamp: 1000, packetsReceived: 50 })).lossPct).toBe(0);
    expect(computeStatsSample(a, stats({ timestamp: 1000 })).lossPct).toBeNull();
  });

  it('treats counters going backwards (new media session) as no rate', () => {
    const a = stats({ timestamp: 0, bytesSent: 9000, packetsSent: 90 });
    const b = stats({ timestamp: 1000, bytesSent: 100, packetsSent: 1 });
    const s = computeStatsSample(a, b);
    expect(s.bitrateOutKbps).toBeNull();
    expect(s.lossPct).toBeNull();
  });

  it('survives a zero or negative time step and non-finite input', () => {
    const a = stats({ timestamp: 1000, bytesSent: 10 });
    expect(computeStatsSample(a, stats({ timestamp: 1000, bytesSent: 20 })).bitrateOutKbps).toBeNull();
    expect(computeStatsSample(a, stats({ timestamp: 500, bytesSent: 20 })).bitrateOutKbps).toBeNull();
    const bad = computeStatsSample(
      a,
      stats({ timestamp: 2000, rttMs: NaN, jitterMs: Infinity, inputLevel: NaN }),
    );
    expect(bad.rttMs).toBeNull();
    expect(bad.jitterMs).toBeNull();
    expect(bad.inputLevel).toBeNull();
  });

  it('falls back to the selected pair rtt', () => {
    const pair = {
      local: { id: 'l', type: 'host', protocol: 'udp', address: null, port: null, networkType: null },
      remote: { id: 'r', type: 'host', protocol: 'udp', address: null, port: null, networkType: null },
      state: 'succeeded',
      rttMs: 42,
    } as const;
    expect(computeStatsSample(null, stats({ rttMs: null, selectedPair: pair })).rttMs).toBe(42);
  });
});

describe('createStatsSampler', () => {
  it('chains samples and starts over after reset', () => {
    const sampler = createStatsSampler();
    expect(sampler.last).toBeNull();
    sampler.sample(stats({ timestamp: 0 }));
    const s = sampler.sample(stats({ timestamp: 1000, bytesSent: 500 }));
    expect(s.bitrateOutKbps).toBeCloseTo(4);
    expect(sampler.last).toBe(s);
    sampler.reset();
    expect(sampler.last).toBeNull();
    expect(sampler.sample(stats({ timestamp: 2000, bytesSent: 900 })).bitrateOutKbps).toBeNull();
  });
});

describe('createStatsPoller', () => {
  it('polls on the clock, derives rates, handles null and failing sources, and stops for good', async () => {
    const clock = new ManualClock(0);
    const samples: (StatsSample | null)[] = [];
    let bytes = 0;
    let mode: 'ok' | 'none' | 'throw' = 'ok';
    const poller = createStatsPoller({
      clock,
      intervalMs: 1000,
      source: async () => {
        if (mode === 'throw') throw new Error('gone');
        if (mode === 'none') return null;
        bytes += 300;
        return stats({ timestamp: clock.now(), bytesSent: bytes });
      },
      onSample: (sample) => {
        samples.push(sample);
      },
    });
    await clock.advance(1000);
    await clock.advance(1000);
    expect(samples).toHaveLength(2);
    expect(samples[0]?.bitrateOutKbps).toBeNull();
    expect(samples[1]?.bitrateOutKbps).toBeCloseTo(2.4);
    mode = 'none';
    await clock.advance(1000);
    mode = 'throw';
    await clock.advance(1000);
    expect(samples.slice(2)).toEqual([null, null]);
    mode = 'ok';
    await clock.advance(1000);
    expect(samples[samples.length - 1]?.bitrateOutKbps).toBeNull(); // fresh baseline after the gap
    poller.stop();
    poller.stop();
    const count = samples.length;
    await clock.advance(10_000);
    expect(samples).toHaveLength(count);
    expect(clock.pendingTimers()).toBe(0);
  });

  it('keeps sampling when the consumer throws', async () => {
    const clock = new ManualClock(0);
    let calls = 0;
    const poller = createStatsPoller({
      clock,
      source: async () => stats({ timestamp: clock.now() }),
      onSample: () => {
        calls += 1;
        throw new Error('consumer bug');
      },
    });
    await clock.advance(3000);
    expect(calls).toBe(3);
    poller.stop();
  });
});

describe('createStatsPoller: stop() clears its timer', () => {
  it('leaves no pending timer immediately after stop(), before any time passes', async () => {
    const clock = new ManualClock(0);
    const poller = createStatsPoller({
      clock,
      intervalMs: 1000,
      source: async () => stats({ timestamp: clock.now() }),
      onSample: () => undefined,
    });
    expect(clock.pendingTimers()).toBe(1);
    poller.stop();
    expect(clock.pendingTimers()).toBe(0);
    await clock.advance(5000);
    expect(clock.pendingTimers()).toBe(0);
  });

  it('leaves no pending timer when stopped while a poll is in flight', async () => {
    const clock = new ManualClock(0);
    let release: () => void = () => undefined;
    let samples = 0;
    const poller = createStatsPoller({
      clock,
      intervalMs: 1000,
      source: () =>
        new Promise((resolve) => {
          release = () => resolve(stats({ timestamp: clock.now() }));
        }),
      onSample: () => {
        samples += 1;
      },
    });
    await clock.advance(1000); // the poll starts and hangs
    poller.stop();
    release();
    await clock.settle();
    expect(samples).toBe(0);
    expect(clock.pendingTimers()).toBe(0);
  });
});
