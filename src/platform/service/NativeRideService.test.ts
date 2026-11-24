import type {
  IntercomRideServiceEvents,
  NativeBatteryInfo,
  NativeRideNotification,
  NativeRideStartOptions,
} from '../../../specs/IntercomRideService';
import {
  createNativeRideService,
  DEFAULT_ACTION_LABELS,
  RideServiceError,
  type RideServiceNativeModule,
} from './NativeRideService';

type ActionListener = IntercomRideServiceEvents['onAction'];

class FakeRideNative implements RideServiceNativeModule {
  running = false;
  startError: string | null = null;
  battery: NativeBatteryInfo | null = { levelPct: 64, charging: false };
  readonly starts: NativeRideStartOptions[] = [];
  readonly updates: NativeRideNotification[] = [];
  readonly actionListeners = new Set<ActionListener>();

  async start(options: NativeRideStartOptions) {
    if (this.startError !== null) throw Object.assign(new Error('refused'), { code: this.startError });
    this.starts.push(options);
    this.running = true;
  }
  async update(notification: NativeRideNotification) {
    this.updates.push(notification);
  }
  async stop() {
    this.running = false;
  }
  async isRunning() {
    return this.running;
  }
  async getBattery() {
    return this.battery;
  }
  addListener<E extends keyof IntercomRideServiceEvents>(
    _eventName: E,
    listener: IntercomRideServiceEvents[E],
  ): { remove(): void } {
    this.actionListeners.add(listener as ActionListener);
    return { remove: () => this.actionListeners.delete(listener as ActionListener) };
  }
  press(action: string) {
    for (const l of [...this.actionListeners]) l({ action } as Parameters<ActionListener>[0]);
  }
}

const NOTIFICATION = { title: 'Ride', text: 'Connected', muted: false, connected: true };

describe('NativeRideService', () => {
  it('starts with channel, notification and the button labels from JS', async () => {
    const native = new FakeRideNative();
    const service = createNativeRideService(native);
    await service.start({ channelId: 'ride', channelName: 'Ride', notification: NOTIFICATION });
    expect(native.starts).toEqual([
      {
        channelId: 'ride',
        channelName: 'Ride',
        notification: NOTIFICATION,
        actionLabels: DEFAULT_ACTION_LABELS,
      },
    ]);
    await expect(service.isRunning()).resolves.toBe(true);
    await service.update({ ...NOTIFICATION, muted: true });
    expect(native.updates).toEqual([{ ...NOTIFICATION, muted: true }]);
    await service.stop();
    await expect(service.isRunning()).resolves.toBe(false);
  });

  it('accepts custom labels', async () => {
    const native = new FakeRideNative();
    const labels = { mute: 'Stumm', unmute: 'Laut', end: 'Ende' };
    await createNativeRideService(native, labels).start({
      channelId: 'c',
      channelName: 'n',
      notification: NOTIFICATION,
    });
    expect(native.starts[0]?.actionLabels).toEqual(labels);
  });

  it.each(['ERR_RIDE_PERMISSION', 'ERR_RIDE_BACKGROUND_START', 'ERR_RIDE_START'])(
    'keeps the native code %s on a failed start',
    async (code) => {
      const native = new FakeRideNative();
      native.startError = code;
      const service = createNativeRideService(native);
      const attempt = service.start({ channelId: 'c', channelName: 'n', notification: NOTIFICATION });
      await expect(attempt).rejects.toBeInstanceOf(RideServiceError);
      await expect(attempt).rejects.toMatchObject({ code });
    },
  );

  it('fans notification actions out to every listener over one native subscription and ignores unknown ones', () => {
    const native = new FakeRideNative();
    const service = createNativeRideService(native);
    const a: string[] = [];
    const b: string[] = [];
    const offA = service.onAction((x) => a.push(x));
    const offB = service.onAction((x) => b.push(x));
    expect(native.actionListeners.size).toBe(1);
    native.press('toggle-mute');
    native.press('bogus');
    native.press('end');
    expect(a).toEqual(['toggle-mute', 'end']);
    expect(b).toEqual(['toggle-mute', 'end']);
    offA();
    expect(native.actionListeners.size).toBe(1);
    offB();
    expect(native.actionListeners.size).toBe(0);
  });

  it('reads the battery and maps failures to null', async () => {
    const native = new FakeRideNative();
    const service = createNativeRideService(native);
    await expect(service.getBattery()).resolves.toEqual({ levelPct: 64, charging: false });
    native.battery = null;
    await expect(service.getBattery()).resolves.toBeNull();
    native.getBattery = () => Promise.reject(new Error('gone'));
    await expect(service.getBattery()).resolves.toBeNull();
  });
});
