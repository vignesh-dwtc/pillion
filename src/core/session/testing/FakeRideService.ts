import type {
  BatteryInfo,
  RideNotificationState,
  RideService,
  RideServiceAction,
  RideServiceStartOptions,
} from '../../../platform/service/RideService';
import type { Unsubscribe } from '../../common/types';

/** Fake `RideService`: records the notification history, emits notification actions, can fail or hang. */
export class FakeRideService implements RideService {
  startCalls = 0;
  stopCalls = 0;
  lastStartOptions: RideServiceStartOptions | null = null;
  readonly updates: RideNotificationState[] = [];

  running = false;
  private battery: BatteryInfo | null = { levelPct: 80, charging: false };
  private startFailure: unknown = null;
  private startHang = false;
  private readonly listeners = new Set<(action: RideServiceAction) => void>();

  async start(options: RideServiceStartOptions): Promise<void> {
    this.startCalls += 1;
    this.lastStartOptions = options;
    if (this.startHang) return new Promise<void>(() => undefined);
    if (this.startFailure !== null) throw this.startFailure;
    this.running = true;
  }

  async update(notification: RideNotificationState): Promise<void> {
    this.updates.push(notification);
  }

  async stop(): Promise<void> {
    this.stopCalls += 1;
    this.running = false;
  }

  async isRunning(): Promise<boolean> {
    return this.running;
  }

  onAction(listener: (action: RideServiceAction) => void): Unsubscribe {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  async getBattery(): Promise<BatteryInfo | null> {
    return this.battery;
  }

  // ---- test controls ----------------------------------------------------------------------------------

  get listenerCount(): number {
    return this.listeners.size;
  }

  /** The user presses a notification button. */
  emitAction(action: RideServiceAction): void {
    for (const listener of [...this.listeners]) listener(action);
  }

  setBattery(battery: BatteryInfo | null): void {
    this.battery = battery;
  }

  failStart(error: unknown = new Error('foreground service refused')): void {
    this.startFailure = error;
  }

  hangStart(on = true): void {
    this.startHang = on;
  }

  get lastUpdate(): RideNotificationState | undefined {
    return this.updates[this.updates.length - 1];
  }
}
