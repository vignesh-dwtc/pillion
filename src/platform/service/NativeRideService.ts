/**
 * RideService over the native IntercomRideService module (specs/IntercomRideService.ts): the Android foreground service
 * (microphone + connectedDevice), its wake and Wi-Fi locks and the notification buttons.
 *
 * start() must run in the handler of a user tap while the app is visible (the native side refuses otherwise with
 * ERR_RIDE_BACKGROUND_START). Rejections keep the native `code` (ERR_RIDE_PERMISSION, ERR_RIDE_BACKGROUND_START,
 * ERR_RIDE_START) on the thrown Error. The notification button labels are supplied here so native code holds no UI copy.
 */
import type {
  IntercomRideServiceEvents,
  NativeBatteryInfo,
  NativeRideAction,
  NativeRideNotification,
  NativeRideStartOptions,
} from '../../../specs/IntercomRideService';
import type { Unsubscribe } from '../../core/common/types';
import type {
  BatteryInfo,
  RideNotificationState,
  RideService,
  RideServiceAction,
  RideServiceStartOptions,
} from './RideService';

/** The part of IntercomRideServiceNativeModule this wrapper uses (the real module satisfies it; tests pass a fake). */
export interface RideServiceNativeModule {
  start(options: NativeRideStartOptions): Promise<void>;
  update(notification: NativeRideNotification): Promise<void>;
  stop(): Promise<void>;
  isRunning(): Promise<boolean>;
  getBattery(): Promise<NativeBatteryInfo | null>;
  addListener<E extends keyof IntercomRideServiceEvents>(
    eventName: E,
    listener: IntercomRideServiceEvents[E],
  ): { remove(): void };
}

export interface RideActionLabels {
  mute: string;
  unmute: string;
  end: string;
}

export const DEFAULT_ACTION_LABELS: RideActionLabels = { mute: 'Mute', unmute: 'Unmute', end: 'End ride' };

const ACTIONS: readonly NativeRideAction[] = ['toggle-mute', 'end'];

/** Error carrying the native rejection code. */
export class RideServiceError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = 'RideServiceError';
    this.code = code;
  }
}

function wrap(error: unknown): RideServiceError {
  if (error instanceof RideServiceError) return error;
  const code = (error as { code?: unknown } | null)?.code;
  const message = error instanceof Error ? error.message : String(error);
  return new RideServiceError(typeof code === 'string' ? code : 'ERR_RIDE_START', message);
}

function notificationOf(state: RideNotificationState): NativeRideNotification {
  return { title: state.title, text: state.text, muted: state.muted, connected: state.connected };
}

export function createNativeRideService(
  native: RideServiceNativeModule,
  labels: RideActionLabels = DEFAULT_ACTION_LABELS,
): RideService {
  const listeners = new Set<(action: RideServiceAction) => void>();
  let subscription: { remove(): void } | null = null;

  return {
    async start(options: RideServiceStartOptions): Promise<void> {
      try {
        await native.start({
          channelId: options.channelId,
          channelName: options.channelName,
          notification: notificationOf(options.notification),
          actionLabels: { ...labels },
        });
      } catch (error) {
        throw wrap(error);
      }
    },
    async update(notification: RideNotificationState): Promise<void> {
      try {
        await native.update(notificationOf(notification));
      } catch (error) {
        throw wrap(error);
      }
    },
    async stop(): Promise<void> {
      try {
        await native.stop();
      } catch (error) {
        throw wrap(error);
      }
    },
    isRunning(): Promise<boolean> {
      return native.isRunning();
    },
    onAction(listener: (action: RideServiceAction) => void): Unsubscribe {
      listeners.add(listener);
      // One native subscription for all JS listeners: the native buffer-of-one is delivered to the first subscriber.
      subscription ??= native.addListener('onAction', (event) => {
        if (!(ACTIONS as readonly string[]).includes(event.action)) return;
        for (const registered of [...listeners]) registered(event.action);
      });
      return () => {
        listeners.delete(listener);
        if (listeners.size === 0 && subscription !== null) {
          subscription.remove();
          subscription = null;
        }
      };
    },
    async getBattery(): Promise<BatteryInfo | null> {
      try {
        const battery = await native.getBattery();
        return battery === null ? null : { levelPct: battery.levelPct, charging: battery.charging };
      } catch {
        return null;
      }
    },
  };
}
