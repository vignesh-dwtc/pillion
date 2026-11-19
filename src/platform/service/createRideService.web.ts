/**
 * Web twin of createRideService: a FAKE RideService for the browser (DEV ONLY).
 *
 * In memory only: it tracks "running", mirrors the notification into `document.title` (the closest thing a browser
 * has to the foreground-service notification) and reports a fake battery from the dev controls (default 80 %, not
 * charging). The dev panel can press the notification buttons. Web proves nothing about the real foreground service,
 * wake locks, Wi-Fi locks or what Android does to a backgrounded app.
 */
import type { Unsubscribe } from '../../core/common/types';
import { devControls } from '../devtools/devControls.web';

import type {
  BatteryInfo,
  RideNotificationState,
  RideService,
  RideServiceAction,
  RideServiceStartOptions,
} from './RideService';

/** Greppable by scripts/check-android-bundle.mjs: this string must never appear in the Android bundle. */
export const WEB_ONLY_FAKE_RIDE_SERVICE = '@@web-only:FakeRideService@@';

function titleFor(notification: RideNotificationState): string {
  const muted = notification.muted ? ' (muted)' : '';
  return `${notification.title}${muted} - ${notification.text}`;
}

class WebFakeRideService implements RideService {
  private running = false;
  private originalTitle: string | null = null;
  private readonly actionListeners = new Set<(action: RideServiceAction) => void>();
  private unsubscribeActions: Unsubscribe | null = null;

  async start(options: RideServiceStartOptions): Promise<void> {
    if (!this.running && typeof document !== 'undefined') this.originalTitle = document.title;
    this.running = true;
    this.applyTitle(options.notification);
  }

  async update(notification: RideNotificationState): Promise<void> {
    if (this.running) this.applyTitle(notification);
  }

  async stop(): Promise<void> {
    if (this.running && typeof document !== 'undefined' && this.originalTitle !== null) {
      document.title = this.originalTitle;
    }
    this.running = false;
    this.originalTitle = null;
  }

  async isRunning(): Promise<boolean> {
    return this.running;
  }

  onAction(listener: (action: RideServiceAction) => void): Unsubscribe {
    this.actionListeners.add(listener);
    this.unsubscribeActions ??= devControls.onRideServiceAction((action) => {
      for (const registered of [...this.actionListeners]) registered(action);
    });
    return () => {
      this.actionListeners.delete(listener);
      if (this.actionListeners.size === 0 && this.unsubscribeActions !== null) {
        this.unsubscribeActions();
        this.unsubscribeActions = null;
      }
    };
  }

  async getBattery(): Promise<BatteryInfo | null> {
    return devControls.getState().battery;
  }

  private applyTitle(notification: RideNotificationState) {
    if (typeof document !== 'undefined') document.title = titleFor(notification);
  }
}

export function createRideService(): RideService {
  return new WebFakeRideService();
}
