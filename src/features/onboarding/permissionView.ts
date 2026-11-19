import type { PermissionKey, PermissionState } from '../../platform/permissions/PermissionService';
import { strings } from '../../app/strings';
import type { Tone } from '../../app/theme';
import type { IconName } from '../components/Icon';

/** Order the permissions are explained in. */
export const PERMISSION_KEYS: readonly PermissionKey[] = [
  'microphone',
  'notifications',
  'bluetooth',
  'nearbyDevices',
];

export const PERMISSION_ICONS: Record<PermissionKey, IconName> = {
  microphone: 'mic',
  notifications: 'bell',
  bluetooth: 'bluetooth',
  nearbyDevices: 'wifi-direct',
};

export interface PermissionStatusView {
  label: string;
  tone: Tone;
  icon: IconName;
  /** What the action button does, if there is one. */
  action: 'allow' | 'open-settings' | null;
}

/** Text, tone and icon per state; the state is always spelled out in words, never only coloured. */
export function describePermissionState(state: PermissionState): PermissionStatusView {
  const label = strings.onboarding.status[state];
  switch (state) {
    case 'granted':
      return { label, tone: 'success', icon: 'check', action: null };
    case 'denied':
      return { label, tone: 'warning', icon: 'warning-triangle', action: 'allow' };
    case 'blocked':
      return { label, tone: 'danger', icon: 'cross', action: 'open-settings' };
    case 'undetermined':
      return { label, tone: 'info', icon: 'info', action: 'allow' };
    case 'unavailable':
      return { label, tone: 'neutral', icon: 'info', action: null };
  }
}
