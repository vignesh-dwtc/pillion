import type {
  PermissionKey,
  PermissionService,
  PermissionState,
  PermissionStatus,
} from '../../../platform/permissions/PermissionService';

/**
 * Fake `PermissionService`. `check()` reports the configured states; `request()` resolves each requested key from
 * `requestOutcome` (what the user does in the dialog) and applies the result.
 */
export class FakePermissionService implements PermissionService {
  checkCalls = 0;
  readonly requested: PermissionKey[][] = [];
  openSettingsCalls = 0;

  private status: PermissionStatus = {
    microphone: 'granted',
    notifications: 'granted',
    bluetooth: 'granted',
    nearbyDevices: 'granted',
  };
  private outcome: Partial<Record<PermissionKey, PermissionState>> = {};
  private requestFailure: unknown = null;

  async check(): Promise<PermissionStatus> {
    this.checkCalls += 1;
    return { ...this.status };
  }

  async request(keys: PermissionKey[]): Promise<PermissionStatus> {
    this.requested.push([...keys]);
    if (this.requestFailure !== null) throw this.requestFailure;
    for (const key of keys) {
      // Only an undetermined or denied permission can still be granted by asking; blocked stays blocked.
      if (
        this.status[key] === 'granted' ||
        this.status[key] === 'blocked' ||
        this.status[key] === 'unavailable'
      ) {
        continue;
      }
      this.status[key] = this.outcome[key] ?? 'granted';
    }
    return { ...this.status };
  }

  async openSettings(): Promise<void> {
    this.openSettingsCalls += 1;
  }

  // ---- test controls ----------------------------------------------------------------------------------

  /** Sets the current state of a permission. */
  set(key: PermissionKey, state: PermissionState): this {
    this.status[key] = state;
    return this;
  }

  /** What the user will answer when asked about `key`. Default: grant. */
  willAnswer(key: PermissionKey, state: PermissionState): this {
    this.outcome[key] = state;
    return this;
  }

  failRequests(error: unknown = new Error('permission request failed')): void {
    this.requestFailure = error;
  }
}
