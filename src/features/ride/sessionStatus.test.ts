import type { SessionState } from '../../core/session/types';

import { describeSession, linkQuality, qualityWord, rideCaption } from './sessionStatus';

const STATES: SessionState[] = [
  'idle',
  'starting',
  'linking',
  'signaling',
  'connecting',
  'connected',
  'reconnecting',
  'ended',
];

describe('describeSession', () => {
  it('gives every session state a label, tone and icon', () => {
    for (const state of STATES) {
      const view = describeSession(state);
      expect(view.label.length).toBeGreaterThan(0);
      expect(view.icon).toBeTruthy();
    }
  });

  it('uses distinct words so the state is never ambiguous', () => {
    const labels = STATES.map((s) => describeSession(s).label);
    expect(new Set(labels).size).toBe(STATES.length);
  });

  it('marks connected as success and reconnecting as a warning', () => {
    expect(describeSession('connected').tone).toBe('success');
    expect(describeSession('reconnecting').tone).toBe('warning');
    expect(describeSession('idle').tone).toBe('neutral');
  });
});

describe('linkQuality', () => {
  it('is high for a clean local link and drops with loss, delay and jitter', () => {
    const clean = linkQuality('connected', { rttMs: 4, lossPct: 0.4, jitterMs: 2 });
    expect(clean).toBeGreaterThan(0.9);
    expect(linkQuality('connected', { rttMs: 4, lossPct: 8, jitterMs: 2 })).toBeLessThan(0.5);
    expect(linkQuality('connected', { rttMs: 280, lossPct: 0, jitterMs: 2 })).toBeLessThan(0.5);
  });

  it('is fixed while not connected', () => {
    expect(linkQuality('reconnecting', null)).toBe(0.15);
    expect(linkQuality('connecting', null)).toBe(0);
  });

  it('names the quality in words', () => {
    expect(qualityWord('connected', 0.9)).toBe('strong');
    expect(qualityWord('connected', 0.5)).toBe('fair');
    expect(qualityWord('connected', 0.2)).toBe('weak');
    expect(qualityWord('reconnecting', 0.9)).toBe('down');
  });
});

describe('rideCaption', () => {
  it('only says the voice is clear while linked with a strong link', () => {
    expect(rideCaption('connected', 0.9, 'Alex')).toMatch(/^Voice clear/);
    expect(rideCaption('connected', 0.5, 'Alex')).toMatch(/^Voice fair/);
    expect(rideCaption('connected', 0.2, 'Alex')).toMatch(/^Voice weak/);
    for (const state of STATES.filter((s) => s !== 'connected')) {
      expect(rideCaption(state, 1, 'Alex')).not.toMatch(/Voice clear/);
    }
  });

  it('names the partner while the link comes up and says the link dropped while reconnecting', () => {
    for (const state of ['starting', 'linking', 'signaling', 'connecting'] as const) {
      expect(rideCaption(state, 0, 'Alex')).toContain('Finding Alex');
    }
    expect(rideCaption('reconnecting', 0.15, 'Alex')).toMatch(/^Link dropped · retrying/);
    expect(rideCaption('idle', 0, 'Alex')).toMatch(/^Not riding/);
    expect(rideCaption('ended', 0, 'Alex')).toMatch(/^Not riding/);
  });
});
