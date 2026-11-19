import type { SessionState } from '../../core/session/types';
import type { IconName } from '../components/Icon';
import { strings } from '../../app/strings';
import type { Tone } from '../../app/theme';

/** How each session state is shown on the ride screen: a word, a tone and an icon (never colour alone). */
export interface SessionStatusView {
  label: string;
  tone: Tone;
  icon: IconName;
  /** The gauge legend state. */
  gauge: 'linked' | 'connecting' | 'reconnecting' | 'idle';
}

export function describeSession(state: SessionState): SessionStatusView {
  const label = strings.ride.states[state];
  switch (state) {
    case 'connected':
      return { label, tone: 'success', icon: 'check', gauge: 'linked' };
    case 'reconnecting':
      return { label, tone: 'warning', icon: 'warning-triangle', gauge: 'reconnecting' };
    case 'idle':
    case 'ended':
      return { label, tone: 'neutral', icon: 'info', gauge: 'idle' };
    case 'starting':
    case 'linking':
    case 'signaling':
    case 'connecting':
      return { label, tone: 'info', icon: 'pulse', gauge: 'connecting' };
  }
}

export interface LinkSample {
  rttMs: number | null;
  lossPct: number | null;
  jitterMs: number | null;
}

/**
 * Link quality 0..1 for the gauge from round-trip time, loss and jitter. 1 is a clean local link (< 20 ms RTT, no
 * loss); 300 ms RTT, 10 % loss or 60 ms jitter each pull it to the bottom. Not connected: 0; reconnecting: 0.15.
 */
export function linkQuality(state: SessionState, sample: LinkSample | null): number {
  if (state === 'reconnecting') return 0.15;
  if (state !== 'connected') return 0;
  if (!sample) return 0.5;
  const rtt = sample.rttMs ?? 50;
  const loss = sample.lossPct ?? 0;
  const jitter = sample.jitterMs ?? 0;
  const rttScore = 1 - Math.min(1, Math.max(0, rtt - 20) / 280);
  const lossScore = 1 - Math.min(1, loss / 10);
  const jitterScore = 1 - Math.min(1, jitter / 60);
  const q =
    Math.min(rttScore, lossScore, jitterScore) * 0.6 + ((rttScore + lossScore + jitterScore) / 3) * 0.4;
  return Math.round(Math.max(0.05, Math.min(1, q)) * 100) / 100;
}

export function qualityWord(state: SessionState, quality: number): string {
  const q = strings.ride.quality;
  if (state !== 'connected') return q.down;
  return quality >= 0.75 ? q.strong : quality >= 0.45 ? q.fair : q.weak;
}

/**
 * The caption under "with <partner>" on the ride screen. It reports what is true now: never "Voice clear" while the
 * link is still coming up or has dropped.
 */
export function rideCaption(state: SessionState, quality: number, partner: string): string {
  const c = strings.ride.captions;
  const view = describeSession(state);
  switch (view.gauge) {
    case 'linked': {
      const v = strings.ride.voice;
      return c.linked(quality >= 0.75 ? v.strong : quality >= 0.45 ? v.fair : v.weak);
    }
    case 'connecting':
      return c.connecting(partner);
    case 'reconnecting':
      return c.reconnecting;
    case 'idle':
      return c.idle;
  }
}
