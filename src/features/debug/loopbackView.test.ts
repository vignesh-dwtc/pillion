import type { LoopbackResult } from '../../platform/media/loopback';

import { describeLoopbackPhase, describeLoopbackResult, formatBytes } from './loopbackView';

const base: LoopbackResult = {
  ok: true,
  failure: null,
  message: null,
  durationMs: 10_500,
  connectMs: 120,
  sender: null,
  receiver: null,
  bytesSent: 40_960,
  bytesReceived: 40_000,
  packetsLost: 0,
};

describe('loopback view', () => {
  it('reports a pass with the counters', () => {
    const view = describeLoopbackResult(base);
    expect(view.tone).toBe('success');
    expect(view.status).toMatch(/^Passed/);
    expect(view.detail).toBe('Connected in 120 ms · sent 40.0 KiB · received 39.1 KiB · lost 0 packets');
  });

  it('spells out a failure in words, never colour alone', () => {
    const view = describeLoopbackResult({ ...base, ok: false, failure: 'no-audio', connectMs: null });
    expect(view.tone).toBe('danger');
    expect(view.status).toBe('Failed: no audio went round the loop');
    expect(view.detail).toContain('Connected in n/a');
    expect(describeLoopbackResult({ ...base, ok: false, failure: 'cancelled' }).tone).toBe('neutral');
  });

  it('shows the phase and elapsed seconds while running', () => {
    expect(describeLoopbackPhase('running', 3_400).status).toBe('Running: speak now · 3 s');
  });

  it('formats byte counts', () => {
    expect(formatBytes(512)).toBe('512 B');
    expect(formatBytes(2048)).toBe('2.0 KiB');
    expect(formatBytes(3 * 1024 * 1024)).toBe('3.0 MiB');
  });
});
