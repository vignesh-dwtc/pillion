import IDENTITY from '../../../config/identity.json';
import { RIDE_CHANNEL_ID, RIDE_CHANNEL_NAME, buildRideNotification } from './notification';
import type { SessionState } from './types';

describe('buildRideNotification', () => {
  const states: SessionState[] = [
    'idle',
    'starting',
    'linking',
    'signaling',
    'connecting',
    'connected',
    'reconnecting',
    'ended',
  ];

  it('takes the product name and channel id from config/identity.json, never from a literal', () => {
    expect(RIDE_CHANNEL_ID).toBe(IDENTITY.notificationChannelId);
    expect(RIDE_CHANNEL_NAME).toContain(IDENTITY.displayName);
    expect(buildRideNotification({ state: 'connected', muted: false, peerName: null }).title).toBe(
      IDENTITY.displayName,
    );
  });

  it('says something short and different for every phase, and flags only connected as connected', () => {
    const texts = new Set<string>();
    for (const state of states) {
      const n = buildRideNotification({ state, muted: false, peerName: 'Sam' });
      expect(n.text.length).toBeGreaterThan(0);
      expect(n.text.length).toBeLessThan(60);
      expect(n.connected).toBe(state === 'connected');
      texts.add(n.text);
    }
    expect(texts.size).toBeGreaterThanOrEqual(6);
  });

  it('names the partner when connected and knows the name', () => {
    expect(buildRideNotification({ state: 'connected', muted: false, peerName: 'Sam' }).text).toBe(
      'Connected to Sam',
    );
    expect(buildRideNotification({ state: 'connected', muted: false, peerName: null }).text).toBe(
      'Connected',
    );
  });

  it('carries the mute flag for the notification action', () => {
    expect(buildRideNotification({ state: 'connected', muted: true, peerName: null }).muted).toBe(true);
    expect(buildRideNotification({ state: 'connected', muted: false, peerName: null }).muted).toBe(false);
  });
});
