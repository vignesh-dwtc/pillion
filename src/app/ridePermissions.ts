import type {
  PermissionKey,
  PermissionState,
  PermissionStatus,
} from '../platform/permissions/PermissionService';

/**
 * Which runtime permissions a ride needs, and what to do about them before Begin ride starts the session. The app
 * explains each permission in its own words first (the primer on Home) and only then lets the system ask; the session
 * controller re-checks and fails the ride with a precise error if something required is still missing.
 *
 *   microphone     required: the voice link
 *   bluetooth      required unless the developer override allows earpiece/speaker (the headset route)
 *   notifications  wanted, never blocking: the ride notification with Mute and End
 *
 * 'unavailable' means "not applicable on this OS / platform" and counts as granted. Pure TypeScript.
 */

export const RIDE_PERMISSION_ORDER: readonly PermissionKey[] = ['microphone', 'notifications', 'bluetooth'];

export interface RidePermissionPlan {
  /** Keys to explain on the primer, in display order (empty: start straight away). */
  explain: PermissionKey[];
  /** Keys the system dialog can still ask for. */
  askable: PermissionKey[];
  /** Required keys that only the system settings can change. */
  blocked: PermissionKey[];
  /** Keys without which the ride cannot start. */
  required: PermissionKey[];
}

const ok = (state: PermissionState): boolean => state === 'granted' || state === 'unavailable';

export function requiredRidePermissions(allowNoHeadset: boolean): PermissionKey[] {
  return allowNoHeadset ? ['microphone'] : ['microphone', 'bluetooth'];
}

export function planRidePermissions(status: PermissionStatus, allowNoHeadset: boolean): RidePermissionPlan {
  const required = requiredRidePermissions(allowNoHeadset);
  const wanted = RIDE_PERMISSION_ORDER.filter((key) => required.includes(key) || key === 'notifications');
  // A refused notification permission never blocks a ride, so it is explained only while it can still be asked.
  const explain = wanted.filter((key) =>
    required.includes(key) ? !ok(status[key]) : status[key] === 'undetermined',
  );
  return {
    explain,
    askable: explain.filter((key) => status[key] === 'undetermined' || status[key] === 'denied'),
    blocked: explain.filter((key) => required.includes(key) && status[key] === 'blocked'),
    required,
  };
}

/** True when every required permission is granted (or not applicable). */
export function canStartRide(status: PermissionStatus, allowNoHeadset: boolean): boolean {
  return requiredRidePermissions(allowNoHeadset).every((key) => ok(status[key]));
}
