import type { Unsubscribe } from '../../core/common/types';

/**
 * RideService: the Android foreground service that keeps a ride alive with the screen off, plus wake and
 * Wi-Fi locks and notification actions. CONTRACT: owned by the lead. Native: Kotlin (`android-native`).
 * Web: fake (`web-verify`).
 *
 * start() must be called from a user tap while the app is in the foreground (Android forbids starting a
 * microphone foreground service from the background). Service types and permissions follow the current
 * Android docs (microphone + connected device); `android-native` verifies them against the docs.
 */

export interface RideNotificationState {
  title: string;
  text: string;
  muted: boolean;
  connected: boolean;
}

export interface RideServiceStartOptions {
  /** Passed from config/identity.json so native code never hard-codes the product name. */
  channelId: string;
  channelName: string;
  notification: RideNotificationState;
}

export type RideServiceAction = 'toggle-mute' | 'end';

export interface BatteryInfo {
  levelPct: number;
  charging: boolean;
}

export interface RideService {
  start(options: RideServiceStartOptions): Promise<void>;
  update(notification: RideNotificationState): Promise<void>;
  stop(): Promise<void>;
  isRunning(): Promise<boolean>;
  /** Notification button presses (and, later, headset media buttons). */
  onAction(listener: (action: RideServiceAction) => void): Unsubscribe;
  /** null when unavailable (web). */
  getBattery(): Promise<BatteryInfo | null>;
}
