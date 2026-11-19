import type { PermissionKey } from './PermissionService';
import {
  ANDROID_PERMISSION,
  planPermission,
  stateFromAndroid,
  unavailableStatus,
  type PermissionPlan,
} from './permissionMapping';

const runtime = (permission: string): PermissionPlan => ({
  kind: 'runtime',
  permission: permission as never,
});
const notRequired: PermissionPlan = { kind: 'not-required' };

describe('planPermission', () => {
  it('microphone is RECORD_AUDIO on every supported API level', () => {
    for (const api of [29, 30, 31, 32, 33, 34, 35, 36]) {
      expect(planPermission('microphone', api)).toEqual(runtime('android.permission.RECORD_AUDIO'));
    }
  });

  it('notifications need POST_NOTIFICATIONS only from API 33', () => {
    for (const api of [29, 30, 31, 32]) expect(planPermission('notifications', api)).toEqual(notRequired);
    for (const api of [33, 34, 36]) {
      expect(planPermission('notifications', api)).toEqual(runtime('android.permission.POST_NOTIFICATIONS'));
    }
  });

  it('bluetooth needs BLUETOOTH_CONNECT only from API 31', () => {
    for (const api of [29, 30]) expect(planPermission('bluetooth', api)).toEqual(notRequired);
    for (const api of [31, 32, 33, 36]) {
      expect(planPermission('bluetooth', api)).toEqual(runtime('android.permission.BLUETOOTH_CONNECT'));
    }
  });

  it('nearbyDevices is location on API 29-32 and NEARBY_WIFI_DEVICES from API 33', () => {
    for (const api of [29, 30, 31, 32]) {
      expect(planPermission('nearbyDevices', api)).toEqual(
        runtime('android.permission.ACCESS_FINE_LOCATION'),
      );
    }
    for (const api of [33, 34, 36]) {
      expect(planPermission('nearbyDevices', api)).toEqual(runtime('android.permission.NEARBY_WIFI_DEVICES'));
    }
  });

  it('only maps to permissions React Native knows by these exact names', () => {
    expect(Object.values(ANDROID_PERMISSION).sort()).toEqual([
      'android.permission.ACCESS_FINE_LOCATION',
      'android.permission.BLUETOOTH_CONNECT',
      'android.permission.NEARBY_WIFI_DEVICES',
      'android.permission.POST_NOTIFICATIONS',
      'android.permission.RECORD_AUDIO',
    ]);
  });

  it('covers every PermissionKey', () => {
    const keys: PermissionKey[] = ['microphone', 'notifications', 'bluetooth', 'nearbyDevices'];
    for (const key of keys) expect(planPermission(key, 34)).toBeDefined();
  });
});

describe('stateFromAndroid', () => {
  it('granted wins over any remembered result', () => {
    expect(stateFromAndroid(true, undefined)).toBe('granted');
    expect(stateFromAndroid(true, 'never_ask_again')).toBe('granted');
  });

  it('maps the last request result when not granted', () => {
    expect(stateFromAndroid(false, undefined)).toBe('undetermined');
    expect(stateFromAndroid(false, 'denied')).toBe('denied');
    expect(stateFromAndroid(false, 'never_ask_again')).toBe('blocked');
  });
});

describe('unavailableStatus', () => {
  it('marks every key unavailable (non-Android platforms)', () => {
    expect(unavailableStatus()).toEqual({
      microphone: 'unavailable',
      notifications: 'unavailable',
      bluetooth: 'unavailable',
      nearbyDevices: 'unavailable',
    });
  });
});
