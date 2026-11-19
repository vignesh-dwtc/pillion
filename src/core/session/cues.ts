import type { CueKind } from '../../platform/audio/AudioRoute';
import type { SessionState } from './types';

/**
 * Audio cue policy, kept in one pure function so it is easy to read, test and change (M3 refines the sounds and
 * adds cues for every state change; the machine only ever asks for these three in M0).
 *
 *   enters connected                          -> 'connected'     (first connection and every recovery)
 *   enters reconnecting (an established link  -> 'reconnecting'  (once per outage, not per retry)
 *     was lost)
 *   ride ends without the local user asking   -> 'disconnected'  (partner ended it, or a fatal error after the
 *     for it                                                      audio route was up)
 *
 * No cue for the local user's own end(), for failed starts (the user is looking at the screen), or for the
 * silent retries of an outage.
 */
export function cueForTransition(
  from: SessionState,
  to: SessionState,
  endedByLocalUser: boolean,
): CueKind | null {
  if (from === to) return null;
  if (to === 'connected') return 'connected';
  if (to === 'reconnecting') return 'reconnecting';
  if (to === 'ended' && !endedByLocalUser) {
    // Only when the ride had got as far as an audio route being up and a link being attempted.
    const wasLive =
      from === 'linking' ||
      from === 'signaling' ||
      from === 'connecting' ||
      from === 'connected' ||
      from === 'reconnecting';
    return wasLive ? 'disconnected' : null;
  }
  return null;
}
