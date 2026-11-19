import type { RideNotificationState } from '../../platform/service/RideService';
import IDENTITY from '../../../config/identity.json';
import type { SessionState } from './types';

/**
 * Content of the foreground-service notification. English defaults: the notification is the only thing visible
 * with the screen off, so it states the connection in a few words. The product name comes from
 * config/identity.json, never from a literal.
 */

export const RIDE_CHANNEL_ID: string = IDENTITY.notificationChannelId;
export const RIDE_CHANNEL_NAME = `${IDENTITY.displayName} ride`;

export interface NotificationInput {
  state: SessionState;
  muted: boolean;
  peerName: string | null;
}

export function buildRideNotification(input: NotificationInput): RideNotificationState {
  let text: string;
  switch (input.state) {
    case 'idle':
    case 'starting':
      text = 'Starting...';
      break;
    case 'linking':
      text = 'Looking for your partner...';
      break;
    case 'signaling':
    case 'connecting':
      text = 'Connecting...';
      break;
    case 'connected':
      text = input.peerName ? `Connected to ${input.peerName}` : 'Connected';
      break;
    case 'reconnecting':
      text = 'Connection lost. Reconnecting...';
      break;
    case 'ended':
      text = 'Ride ended';
      break;
  }
  return {
    title: IDENTITY.displayName,
    text,
    muted: input.muted,
    connected: input.state === 'connected',
  };
}
