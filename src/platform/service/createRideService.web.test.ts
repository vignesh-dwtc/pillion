import { devControls } from '../devtools/devControls.web';

import { createRideService } from './createRideService.web';

const notification = { title: 'Ride active', text: 'Connected to Anna', muted: false, connected: true };
const options = { channelId: 'ride', channelName: 'Ride', notification };

const fakeDocument = { title: 'Original title' };

beforeEach(() => {
  devControls.reset();
  fakeDocument.title = 'Original title';
  (globalThis as { document?: unknown }).document = fakeDocument;
});

afterAll(() => {
  delete (globalThis as { document?: unknown }).document;
});

describe('web fake RideService', () => {
  it('tracks running state and mirrors the notification into the document title', async () => {
    const service = createRideService();
    expect(await service.isRunning()).toBe(false);

    await service.start(options);
    expect(await service.isRunning()).toBe(true);
    expect(fakeDocument.title).toBe('Ride active - Connected to Anna');

    await service.update({ ...notification, muted: true, text: 'Reconnecting' });
    expect(fakeDocument.title).toBe('Ride active (muted) - Reconnecting');

    await service.stop();
    expect(await service.isRunning()).toBe(false);
    expect(fakeDocument.title).toBe('Original title');
  });

  it('ignores update() while stopped and stop() twice is harmless', async () => {
    const service = createRideService();
    await service.update(notification);
    expect(fakeDocument.title).toBe('Original title');
    await service.stop();
    await service.stop();
    expect(fakeDocument.title).toBe('Original title');
  });

  it('keeps the original title when start() is called twice', async () => {
    const service = createRideService();
    await service.start(options);
    await service.start(options);
    await service.stop();
    expect(fakeDocument.title).toBe('Original title');
  });

  it('reports the fake battery from the dev controls, null when unavailable', async () => {
    const service = createRideService();
    expect(await service.getBattery()).toEqual({ levelPct: 80, charging: false });
    devControls.setBattery({ levelPct: 15, charging: true });
    expect(await service.getBattery()).toEqual({ levelPct: 15, charging: true });
    devControls.setBattery(null);
    expect(await service.getBattery()).toBeNull();
  });

  it('delivers notification button presses from the dev controls until unsubscribed', () => {
    const service = createRideService();
    const first: string[] = [];
    const second: string[] = [];
    const offFirst = service.onAction((action) => first.push(action));
    const offSecond = service.onAction((action) => second.push(action));

    devControls.pressRideServiceAction('toggle-mute');
    offFirst();
    devControls.pressRideServiceAction('end');
    offSecond();
    devControls.pressRideServiceAction('end');

    expect(first).toEqual(['toggle-mute']);
    expect(second).toEqual(['toggle-mute', 'end']);
  });
});
