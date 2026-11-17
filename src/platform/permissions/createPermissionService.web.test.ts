import { devControls } from '../devtools/devControls.web';

import { createPermissionService } from './createPermissionService.web';

type Scope = { navigator?: unknown };
const scope = globalThis as unknown as Scope;
const realNavigator = Object.getOwnPropertyDescriptor(globalThis, 'navigator');

function stubNavigator(value: unknown) {
  Object.defineProperty(globalThis, 'navigator', { value, configurable: true, writable: true });
}

beforeEach(() => {
  devControls.reset();
  stubNavigator({});
});

afterAll(() => {
  if (realNavigator) Object.defineProperty(globalThis, 'navigator', realNavigator);
  else delete scope.navigator;
});

describe('web fake PermissionService', () => {
  it('reports the browser microphone permission and fakes the rest as granted', async () => {
    stubNavigator({ permissions: { query: async () => ({ state: 'granted' }) } });
    expect(await createPermissionService().check()).toEqual({
      microphone: 'granted',
      notifications: 'granted',
      bluetooth: 'granted',
      nearbyDevices: 'granted',
    });
  });

  it('maps prompt to undetermined, denied to blocked, and a missing Permissions API to undetermined', async () => {
    const service = createPermissionService();
    stubNavigator({ permissions: { query: async () => ({ state: 'prompt' }) } });
    expect((await service.check()).microphone).toBe('undetermined');
    stubNavigator({ permissions: { query: async () => ({ state: 'denied' }) } });
    expect((await service.check()).microphone).toBe('blocked');
    stubNavigator({
      permissions: { query: async () => Promise.reject(new TypeError('unknown permission')) },
    });
    expect((await service.check()).microphone).toBe('undetermined');
    stubNavigator({});
    expect((await service.check()).microphone).toBe('undetermined');
  });

  it('request(microphone) asks the browser for capture, stops the tracks and reports the result', async () => {
    let granted = false;
    const stopped: boolean[] = [];
    stubNavigator({
      permissions: { query: async () => ({ state: granted ? 'granted' : 'prompt' }) },
      mediaDevices: {
        getUserMedia: async () => {
          granted = true;
          return { getTracks: () => [{ stop: () => stopped.push(true) }] };
        },
      },
    });
    const service = createPermissionService();
    expect((await service.check()).microphone).toBe('undetermined');
    expect((await service.request(['microphone'])).microphone).toBe('granted');
    expect(stopped).toEqual([true]);
  });

  it('request(microphone) reports the denial when the browser refuses', async () => {
    stubNavigator({
      permissions: { query: async () => ({ state: 'denied' }) },
      mediaDevices: { getUserMedia: async () => Promise.reject(new DOMException('no', 'NotAllowedError')) },
    });
    expect((await createPermissionService().request(['microphone'])).microphone).toBe('blocked');
  });

  it('lets the dev controls pin any key, and a pinned microphone is never requested from the browser', async () => {
    let asked = false;
    stubNavigator({
      mediaDevices: {
        getUserMedia: async () => {
          asked = true;
          return { getTracks: () => [] };
        },
      },
    });
    devControls.overridePermission('microphone', 'blocked');
    devControls.overridePermission('bluetooth', 'denied');
    const service = createPermissionService();
    const status = await service.request(['microphone', 'bluetooth']);
    expect(status).toMatchObject({ microphone: 'blocked', bluetooth: 'denied', notifications: 'granted' });
    expect(asked).toBe(false);

    devControls.overridePermission('microphone', null);
    devControls.overridePermission('bluetooth', null);
    expect((await service.check()).bluetooth).toBe('granted');
  });

  it('counts openSettings() calls instead of opening anything', async () => {
    const service = createPermissionService();
    await service.openSettings();
    await service.openSettings();
    expect(devControls.getState().openSettingsCount).toBe(2);
  });
});
