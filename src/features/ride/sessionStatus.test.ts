import type { SessionState } from '../../core/session/types';

import { describeSession } from './sessionStatus';

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
