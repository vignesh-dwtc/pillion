import { devControls } from '../devtools/devControls.web';

import type { AudioRouteState } from './AudioRoute';
import { createAudioRoute } from './createAudioRoute.web';

beforeEach(() => {
  devControls.reset();
});

describe('web fake AudioRoute', () => {
  it('reports an inactive route with a connected headset by default', async () => {
    const route = createAudioRoute();
    const state = await route.getState();
    expect(state).toMatchObject({
      status: 'inactive',
      communicationMode: false,
      headsetConnected: true,
      activeDeviceId: null,
      error: null,
    });
    expect(state.devices.map((device) => device.kind)).toEqual(['bluetooth-sco', 'earpiece', 'speaker']);
  });

  it('start() routes to the headset and stop() restores everything', async () => {
    const route = createAudioRoute();
    const started = await route.start({ allowFallbackDevice: false });
    expect(started).toMatchObject({ status: 'active', communicationMode: true, usingFallback: false });
    expect(started.devices.find((device) => device.id === started.activeDeviceId)?.kind).toBe(
      'bluetooth-sco',
    );

    await route.stop();
    expect(await route.getState()).toMatchObject({
      status: 'inactive',
      communicationMode: false,
      activeDeviceId: null,
    });
  });

  it('no headset is an error state unless the developer override allows a fallback', async () => {
    devControls.setHeadsetConnected(false);
    const route = createAudioRoute();
    const noHeadset = await route.start({ allowFallbackDevice: false });
    expect(noHeadset).toMatchObject({ status: 'no-headset', headsetConnected: false, activeDeviceId: null });
    expect(noHeadset.error).toBeTruthy();

    const fallback = await route.setAllowFallback(true);
    expect(fallback).toMatchObject({ status: 'active', usingFallback: true, error: null });
    expect(fallback.devices.find((device) => device.id === fallback.activeDeviceId)?.kind).toBe('earpiece');

    expect(await route.setAllowFallback(false)).toMatchObject({ status: 'no-headset' });
  });

  it('follows the headset while running and notifies listeners once per change', async () => {
    const route = createAudioRoute();
    const seen: AudioRouteState[] = [];
    const unsubscribe = route.onChange((state) => seen.push(state));
    await route.start({ allowFallbackDevice: false });
    seen.length = 0;

    devControls.setHeadsetConnected(false);
    devControls.setHeadsetConnected(false); // no change, no event
    devControls.setHeadsetConnected(true);

    expect(seen.map((state) => state.status)).toEqual(['no-headset', 'active']);
    unsubscribe();
    devControls.setHeadsetConnected(false);
    expect(seen).toHaveLength(2);
  });

  it('a phone call takes communication mode away and gives it back', async () => {
    const route = createAudioRoute();
    await route.start({ allowFallbackDevice: false });
    const seen: AudioRouteState[] = [];
    route.onChange((state) => seen.push(state));

    devControls.setPhoneCallActive(true);
    expect(seen.at(-1)).toMatchObject({ status: 'failed', communicationMode: false, error: 'phone-call' });

    devControls.setPhoneCallActive(false);
    expect(seen.at(-1)).toMatchObject({ status: 'active', communicationMode: true, error: null });
  });

  it('does not react to the world after stop() when nobody listens', async () => {
    const route = createAudioRoute();
    await route.start({ allowFallbackDevice: false });
    await route.stop();
    devControls.setHeadsetConnected(false);
    expect(await route.getState()).toMatchObject({ status: 'inactive', headsetConnected: false });
  });

  it('records cues in the dev controls and never throws without an AudioContext', async () => {
    const route = createAudioRoute();
    await expect(route.playCue('connected')).resolves.toBeUndefined();
    await route.playCue('disconnected');
    expect(devControls.getState()).toMatchObject({ lastCue: 'disconnected', cueCount: 2 });
  });
});
