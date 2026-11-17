import type { SessionState } from '../../core/session/types';
import type { IconName } from '../components/Icon';
import { strings } from '../../app/strings';
import type { Tone } from '../../app/theme';

/** How each session state is shown on the ride screen: a word, a tone and an icon (never colour alone). */
export interface SessionStatusView {
  label: string;
  tone: Tone;
  icon: IconName;
}

export function describeSession(state: SessionState): SessionStatusView {
  const label = strings.ride.states[state];
  switch (state) {
    case 'connected':
      return { label, tone: 'success', icon: 'check' };
    case 'reconnecting':
      return { label, tone: 'warning', icon: 'alert' };
    case 'idle':
    case 'ended':
      return { label, tone: 'neutral', icon: 'info' };
    case 'starting':
    case 'linking':
    case 'signaling':
    case 'connecting':
      return { label, tone: 'info', icon: 'clock' };
  }
}
