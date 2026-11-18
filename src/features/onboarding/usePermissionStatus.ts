import { useCallback, useEffect, useState } from 'react';
import { AppState } from 'react-native';

import { permissionService } from '../../app/composition';
import type { PermissionStatus } from '../../platform/permissions/PermissionService';

export const UNKNOWN_PERMISSIONS: PermissionStatus = {
  microphone: 'undetermined',
  notifications: 'undetermined',
  bluetooth: 'undetermined',
  nearbyDevices: 'undetermined',
};

/** Current permission status, re-read whenever the app comes back to the foreground (e.g. from system settings). */
export function usePermissionStatus(): [PermissionStatus, (next: PermissionStatus) => void] {
  const [status, setStatus] = useState<PermissionStatus>(UNKNOWN_PERMISSIONS);
  const set = useCallback((next: PermissionStatus) => setStatus(next), []);

  useEffect(() => {
    let cancelled = false;
    const load = () => {
      permissionService.check().then(
        (next) => {
          if (!cancelled) setStatus(next);
        },
        () => {
          if (!cancelled) setStatus(UNKNOWN_PERMISSIONS);
        },
      );
    };
    load();
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') load();
    });
    return () => {
      cancelled = true;
      subscription.remove();
    };
  }, []);

  return [status, set];
}
