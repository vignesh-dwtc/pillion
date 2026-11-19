import { Linking, PermissionsAndroid, Platform, type Permission } from 'react-native';

import type {
  PermissionKey,
  PermissionService,
  PermissionState,
  PermissionStatus,
} from './PermissionService';
import {
  planPermission,
  stateFromAndroid,
  unavailableStatus,
  type AndroidRequestResult,
} from './permissionMapping';

const KEYS: PermissionKey[] = ['microphone', 'notifications', 'bluetooth', 'nearbyDevices'];

/**
 * Native PermissionService over React Native's PermissionsAndroid (no extra library). Which Android permission each
 * key maps to depends on the API level: see `permissionMapping.ts`. On a non-Android platform every key reports
 * 'unavailable'. The web twin (`createPermissionService.web.ts`, owned by `web-verify`) is a fake.
 *
 * Compiles and is unit-tested through the mapping module; untested on a device.
 */
export function createPermissionService(): PermissionService {
  const isAndroid = Platform.OS === 'android';
  const apiLevel = isAndroid ? Number(Platform.Version) : 0;
  const lastResult = new Map<PermissionKey, AndroidRequestResult>();

  async function stateOf(key: PermissionKey): Promise<PermissionState> {
    const plan = planPermission(key, apiLevel);
    if (plan.kind === 'not-required') return 'granted';
    const granted = await PermissionsAndroid.check(plan.permission as Permission);
    return stateFromAndroid(granted, lastResult.get(key));
  }

  async function check(): Promise<PermissionStatus> {
    if (!isAndroid) return unavailableStatus();
    const status = unavailableStatus();
    for (const key of KEYS) {
      status[key] = await stateOf(key);
    }
    return status;
  }

  return {
    check,
    async request(keys: PermissionKey[]): Promise<PermissionStatus> {
      if (!isAndroid) return unavailableStatus();
      // One at a time, so every result is attributed to its own key and the system dialogs do not stack up.
      for (const key of new Set(keys)) {
        const plan = planPermission(key, apiLevel);
        if (plan.kind === 'not-required') continue;
        try {
          const result = await PermissionsAndroid.request(plan.permission as Permission);
          lastResult.set(key, result);
        } catch (error) {
          // No foreground activity or a native failure: leave the state as it was and report the real status.
          console.warn(
            `Permission request failed for ${key}: ${error instanceof Error ? error.message : 'unknown'}`,
          );
        }
      }
      return check();
    },
    async openSettings(): Promise<void> {
      await Linking.openSettings();
    },
  };
}
