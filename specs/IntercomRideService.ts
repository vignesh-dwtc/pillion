import { NativeModule, requireOptionalNativeModule } from 'expo';

/**
 * JS surface of the native module `IntercomRideService` (Kotlin class IntercomRideServiceModule). The TypeScript wrapper
 * (src/platform/service/RideService wrapper, M1) adapts it to the frozen `RideService` interface.
 *
 * Behaviour (implemented in M1; M0 provides `getInfo`, `isRunning` (always false) and `getBattery`):
 *  - start: starts a foreground service with types microphone + connectedDevice, shows the ongoing notification
 *    (channel id and strings come from JS), takes a partial wake lock and a Wi-Fi lock. MUST be called from a user tap
 *    while the app is visible: Android 14+ refuses to start a microphone foreground service from the background
 *    (ForegroundServiceStartNotAllowedException). The RECORD_AUDIO runtime permission must already be granted (a microphone
 *    service started without it throws SecurityException).
 *  - update: refreshes the notification text and buttons.
 *  - stop: stops the service and releases the locks. Idempotent.
 *  - `onAction`: notification button presses.
 *
 * THREADING. Async functions run on the Expo module queue. Notification actions are delivered by a broadcast on the main
 * thread and forwarded as `onAction` events; if JS is not listening yet, the last action is buffered and delivered on the
 * first listener (buffer of one: only the most recent press matters).
 *
 * ERRORS. ERR_NOT_IMPLEMENTED (M0), ERR_RIDE_PERMISSION (RECORD_AUDIO or notifications blocked),
 * ERR_RIDE_BACKGROUND_START (start refused because the app was not in the foreground), ERR_RIDE_START.
 */

export const INTERCOM_RIDE_SERVICE_MODULE_NAME = 'IntercomRideService';
export const INTERCOM_RIDE_SERVICE_API_VERSION = 1;

export interface NativeRideNotification {
  title: string;
  text: string;
  muted: boolean;
  connected: boolean;
}

export interface NativeRideStartOptions {
  /** config/identity.json `notificationChannelId`. */
  channelId: string;
  /** Localised channel name shown in system settings. */
  channelName: string;
  notification: NativeRideNotification;
  /** Labels of the notification buttons, supplied by JS so native code holds no UI strings. */
  actionLabels?: { mute: string; unmute: string; end: string };
}

export type NativeRideAction = 'toggle-mute' | 'end';

export interface NativeBatteryInfo {
  /** 0..100. */
  levelPct: number;
  charging: boolean;
}

export interface RideServiceModuleInfo {
  apiVersion: number;
  sdkInt: number;
}

export type IntercomRideServiceEvents = {
  onAction(event: { action: NativeRideAction }): void;
  /** Ride clock: fires when a timer scheduled with scheduleTimer elapses (see D-064). */
  onTimer(event: { id: number }): void;
};

export declare class IntercomRideServiceNativeModule extends NativeModule<IntercomRideServiceEvents> {
  readonly API_VERSION: number;

  getInfo(): Promise<RideServiceModuleInfo>;
  start(options: NativeRideStartOptions): Promise<void>;
  update(notification: NativeRideNotification): Promise<void>;
  stop(): Promise<void>;
  isRunning(): Promise<boolean>;
  /** null when the platform reports no battery information. */
  getBattery(): Promise<NativeBatteryInfo | null>;
  /**
   * Ride clock (D-064). React Native 0.88 pauses JS setTimeout/setInterval while the app is backgrounded, which
   * would stop heartbeats and reconnects with the screen off. These timers run natively and are delivered via
   * onTimer. Returns false if the timer could not be scheduled.
   */
  scheduleTimer(id: number, delayMs: number): boolean;
  cancelTimer(id: number): void;
}

export function getIntercomRideServiceModule(): IntercomRideServiceNativeModule | null {
  return requireOptionalNativeModule<IntercomRideServiceNativeModule>(INTERCOM_RIDE_SERVICE_MODULE_NAME);
}
