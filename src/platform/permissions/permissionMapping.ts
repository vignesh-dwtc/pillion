import type { PermissionKey, PermissionState } from './PermissionService';

/**
 * Pure mapping from the app's permission keys to Android runtime permissions per API level, kept free of
 * react-native so Jest covers it. Rules (see PermissionService.ts):
 *   microphone     RECORD_AUDIO on every supported level (minSdk 29).
 *   notifications  POST_NOTIFICATIONS on API 33+; below that notifications need no permission ('granted').
 *   bluetooth      BLUETOOTH_CONNECT on API 31+; below that the legacy BLUETOOTH permission is install-time ('granted').
 *   nearbyDevices  NEARBY_WIFI_DEVICES on API 33+; ACCESS_FINE_LOCATION on API 29-32 (Wi-Fi Direct needs it there).
 */

export const ANDROID_PERMISSION = {
  recordAudio: 'android.permission.RECORD_AUDIO',
  postNotifications: 'android.permission.POST_NOTIFICATIONS',
  bluetoothConnect: 'android.permission.BLUETOOTH_CONNECT',
  nearbyWifiDevices: 'android.permission.NEARBY_WIFI_DEVICES',
  accessFineLocation: 'android.permission.ACCESS_FINE_LOCATION',
} as const;

export type AndroidPermissionName = (typeof ANDROID_PERMISSION)[keyof typeof ANDROID_PERMISSION];

export type PermissionPlan =
  /** The user must grant this runtime permission. */
  | { kind: 'runtime'; permission: AndroidPermissionName }
  /** Nothing to ask on this API level: the capability is available without a runtime grant. */
  | { kind: 'not-required' };

export const API_ANDROID_12 = 31;
export const API_ANDROID_13 = 33;

export function planPermission(key: PermissionKey, apiLevel: number): PermissionPlan {
  switch (key) {
    case 'microphone':
      return { kind: 'runtime', permission: ANDROID_PERMISSION.recordAudio };
    case 'notifications':
      return apiLevel >= API_ANDROID_13
        ? { kind: 'runtime', permission: ANDROID_PERMISSION.postNotifications }
        : { kind: 'not-required' };
    case 'bluetooth':
      return apiLevel >= API_ANDROID_12
        ? { kind: 'runtime', permission: ANDROID_PERMISSION.bluetoothConnect }
        : { kind: 'not-required' };
    case 'nearbyDevices':
      return {
        kind: 'runtime',
        permission:
          apiLevel >= API_ANDROID_13
            ? ANDROID_PERMISSION.nearbyWifiDevices
            : ANDROID_PERMISSION.accessFineLocation,
      };
  }
}

/** What `PermissionsAndroid.request` resolves with. */
export type AndroidRequestResult = 'granted' | 'denied' | 'never_ask_again';

/**
 * State of a runtime permission from what Android tells us. `PermissionsAndroid.check` only answers granted or
 * not, and React Native exposes no "should show rationale" query, so denied / blocked is known only from this
 * process's own last request result. After an app restart a previously denied permission therefore reads
 * 'undetermined' until the next `request`, which answers immediately (no dialog) with the real result.
 */
export function stateFromAndroid(
  granted: boolean,
  lastResult: AndroidRequestResult | undefined,
): PermissionState {
  if (granted) return 'granted';
  if (lastResult === 'never_ask_again') return 'blocked';
  if (lastResult === 'denied') return 'denied';
  return 'undetermined';
}

export function unavailableStatus(): Record<PermissionKey, PermissionState> {
  return {
    microphone: 'unavailable',
    notifications: 'unavailable',
    bluetooth: 'unavailable',
    nearbyDevices: 'unavailable',
  };
}
