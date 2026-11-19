/**
 * Runtime permissions. CONTRACT: owned by the lead. Native: React Native PermissionsAndroid (no extra library);
 * web: fake. Owned by `ui` (JS-only wrappers); `.web.ts` by `web-verify`.
 *
 * Which Android permission each key maps to depends on the OS version (e.g. `notifications` is
 * POST_NOTIFICATIONS on API 33+, always 'granted' below; `bluetooth` is BLUETOOTH_CONNECT on API 31+;
 * `nearbyDevices` is NEARBY_WIFI_DEVICES on API 33+ and location below, needed from M2).
 * 'unavailable' means "not applicable on this OS version / platform", not "denied".
 */

export type PermissionKey = 'microphone' | 'notifications' | 'bluetooth' | 'nearbyDevices';

export type PermissionState =
  | 'granted'
  | 'denied' // can be asked again
  | 'blocked' // "don't ask again": only the system settings can change it
  | 'undetermined'
  | 'unavailable';

export type PermissionStatus = Record<PermissionKey, PermissionState>;

export interface PermissionService {
  check(): Promise<PermissionStatus>;
  request(keys: PermissionKey[]): Promise<PermissionStatus>;
  openSettings(): Promise<void>;
}
