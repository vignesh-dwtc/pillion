import type {
  IntercomAudioRouteNativeModule,
  NativeAudioRouteState,
} from '../../../specs/IntercomAudioRoute';
import {
  AudioRouteUnavailableError,
  createAudioRoute,
  createAudioRouteFromModule,
  toAudioRouteState,
} from './createAudioRoute';

const mockRequireOptionalNativeModule = jest.fn();
jest.mock('expo', () => ({
  NativeModule: class {},
  requireOptionalNativeModule: (name: string) => mockRequireOptionalNativeModule(name),
}));

const ACTIVE: NativeAudioRouteState = {
  status: 'active',
  communicationMode: true,
  devices: [
    { id: '7', kind: 'bluetooth-sco', name: 'Buds', hasMic: true },
    { id: '1', kind: 'earpiece', name: 'Earpiece', hasMic: true },
  ],
  activeDeviceId: '7',
  headsetConnected: true,
  usingFallback: false,
  error: null,
  wouldChoose: '7',
};

function fakeModule(overrides: Partial<Record<string, unknown>> = {}) {
  const listeners = new Set<(state: NativeAudioRouteState) => void>();
  const remove = jest.fn();
  const module = {
    API_VERSION: 1,
    getInfo: jest.fn(async () => ({ apiVersion: 1, sdkInt: 34 })),
    getState: jest.fn(async () => ACTIVE),
    start: jest.fn(async () => ACTIVE),
    stop: jest.fn(async () => undefined),
    setAllowFallback: jest.fn(async () => ({ ...ACTIVE, usingFallback: true })),
    playCue: jest.fn(async () => undefined),
    addListener: jest.fn((event: string, listener: (state: NativeAudioRouteState) => void) => {
      expect(event).toBe('onChange');
      listeners.add(listener);
      return {
        remove: () => {
          remove();
          listeners.delete(listener);
        },
      };
    }),
    ...overrides,
  };
  return {
    module: module as unknown as IntercomAudioRouteNativeModule,
    raw: module,
    emit: (state: NativeAudioRouteState) => listeners.forEach((l) => l(state)),
    remove,
    listenerCount: () => listeners.size,
  };
}

describe('createAudioRoute over the IntercomAudioRoute module', () => {
  it('looks the module up by its spec name', async () => {
    const fake = fakeModule();
    mockRequireOptionalNativeModule.mockReturnValue(fake.module);
    const route = createAudioRoute();
    expect(mockRequireOptionalNativeModule).toHaveBeenCalledWith('IntercomAudioRoute');
    await expect(route.getState()).resolves.toMatchObject({ status: 'active' });
  });

  it('start passes the fallback option and strips native-only fields', async () => {
    const fake = fakeModule();
    const route = createAudioRouteFromModule(fake.module);
    const state = await route.start({ allowFallbackDevice: false });
    expect(fake.raw.start).toHaveBeenCalledWith({ allowFallbackDevice: false });
    expect(state).toEqual({
      status: 'active',
      communicationMode: true,
      devices: ACTIVE.devices,
      activeDeviceId: '7',
      headsetConnected: true,
      usingFallback: false,
      error: null,
    });
    expect(state).not.toHaveProperty('wouldChoose');
  });

  it('forwards stop, setAllowFallback and playCue', async () => {
    const fake = fakeModule();
    const route = createAudioRouteFromModule(fake.module);
    await route.stop();
    expect(fake.raw.stop).toHaveBeenCalledTimes(1);
    await expect(route.setAllowFallback(true)).resolves.toMatchObject({ usingFallback: true });
    expect(fake.raw.setAllowFallback).toHaveBeenCalledWith(true);
    await route.playCue('connected');
    expect(fake.raw.playCue).toHaveBeenCalledWith('connected');
  });

  it('onChange delivers normalised snapshots and unsubscribes once', () => {
    const fake = fakeModule();
    const route = createAudioRouteFromModule(fake.module);
    const seen: string[] = [];
    const off = route.onChange((s) => seen.push(`${s.status}:${s.headsetConnected}`));
    fake.emit({ ...ACTIVE, status: 'no-headset', headsetConnected: false, activeDeviceId: null });
    off();
    off();
    fake.emit(ACTIVE);
    expect(seen).toEqual(['no-headset:false']);
    expect(fake.remove).toHaveBeenCalledTimes(1);
  });

  it('native errors pass through with their code', async () => {
    const error = Object.assign(new Error('BLUETOOTH_CONNECT missing'), { code: 'ERR_AUDIO_PERMISSION' });
    const fake = fakeModule({ start: jest.fn(async () => Promise.reject(error)) });
    await expect(createAudioRouteFromModule(fake.module).start({ allowFallbackDevice: false })).rejects.toBe(
      error,
    );
  });
});

describe('missing or mismatched module fails clearly', () => {
  it('a missing module rejects every call with AudioRouteUnavailableError; stop and onChange stay safe', async () => {
    mockRequireOptionalNativeModule.mockReturnValue(null);
    const route = createAudioRoute();
    await expect(route.start({ allowFallbackDevice: true })).rejects.toBeInstanceOf(
      AudioRouteUnavailableError,
    );
    await expect(route.getState()).rejects.toThrow(/IntercomAudioRoute is missing/);
    await expect(route.setAllowFallback(true)).rejects.toMatchObject({ code: 'ERR_AUDIO_ROUTE_UNAVAILABLE' });
    await expect(route.playCue('error')).rejects.toBeInstanceOf(AudioRouteUnavailableError);
    await expect(route.stop()).resolves.toBeUndefined();
    expect(() => route.onChange(() => undefined)()).not.toThrow();
  });

  it('an API version mismatch is refused', async () => {
    const fake = fakeModule({ API_VERSION: 2 });
    const route = createAudioRouteFromModule(fake.module);
    await expect(route.start({ allowFallbackDevice: false })).rejects.toThrow(
      /API version 2, the app expects 1/,
    );
    expect(fake.raw.start).not.toHaveBeenCalled();
  });
});

describe('toAudioRouteState', () => {
  it('turns garbage into a failed state instead of throwing', () => {
    expect(toAudioRouteState(null)).toMatchObject({ status: 'failed', devices: [] });
    expect(toAudioRouteState({ status: 'weird', devices: 'nope' })).toMatchObject({
      status: 'failed',
      error: "unknown status 'weird'",
      devices: [],
    });
  });

  it('keeps valid devices, coerces unknown kinds and numeric ids', () => {
    const state = toAudioRouteState({
      status: 'no-headset',
      devices: [{ id: 3, kind: 'hearing-aid', name: 'HA', hasMic: false }, { kind: 'speaker' }, null],
    });
    expect(state.devices).toEqual([{ id: '3', kind: 'other', name: 'HA', hasMic: false }]);
    expect(state.status).toBe('no-headset');
    expect(state.error).toBeNull();
  });
});
