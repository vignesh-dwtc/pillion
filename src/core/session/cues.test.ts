import { cueForTransition } from './cues';
import type { SessionState } from './types';

describe('cueForTransition', () => {
  it('plays connected on every entry to connected, first connection and recovery alike', () => {
    expect(cueForTransition('connecting', 'connected', false)).toBe('connected');
    expect(cueForTransition('reconnecting', 'connected', false)).toBe('connected');
  });

  it('plays reconnecting when an established link is lost', () => {
    expect(cueForTransition('connected', 'reconnecting', false)).toBe('reconnecting');
  });

  it('plays disconnected when the ride ends by itself after it had started linking', () => {
    for (const from of [
      'linking',
      'signaling',
      'connecting',
      'connected',
      'reconnecting',
    ] as SessionState[]) {
      expect(cueForTransition(from, 'ended', false)).toBe('disconnected');
    }
  });

  it('stays silent for the local user ending the ride and for a start that failed', () => {
    expect(cueForTransition('connected', 'ended', true)).toBeNull();
    expect(cueForTransition('starting', 'ended', false)).toBeNull();
    expect(cueForTransition('idle', 'ended', false)).toBeNull();
  });

  it('stays silent for the quiet steps of the start sequence and for no change', () => {
    expect(cueForTransition('starting', 'linking', false)).toBeNull();
    expect(cueForTransition('linking', 'signaling', false)).toBeNull();
    expect(cueForTransition('signaling', 'connecting', false)).toBeNull();
    expect(cueForTransition('connected', 'connected', false)).toBeNull();
  });
});
