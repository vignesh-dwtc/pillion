/**
 * Web twin of createPermissionService: a FAKE PermissionService for the browser (DEV ONLY).
 *
 * Only the microphone is real: it asks the browser (`navigator.permissions` / `getUserMedia`; Playwright grants it with
 * Chromium's fake UI flag). The other keys report 'granted' because the web has no Bluetooth, notification or
 * nearby-devices runtime permission that matters here. The dev controls can pin any key to a state (for example
 * 'blocked') to exercise the denied and blocked flows. `openSettings()` is a no-op that is counted.
 *
 * Web proves the onboarding / permission FLOW only, never what Android's permission dialogs do.
 */
import { devControls } from '../devtools/devControls.web';

import type {
  PermissionKey,
  PermissionService,
  PermissionState,
  PermissionStatus,
} from './PermissionService';

/** Greppable by scripts/check-android-bundle.mjs: this string must never appear in the Android bundle. */
export const WEB_ONLY_FAKE_PERMISSIONS = '@@web-only:FakePermissionService@@';

const KEYS: PermissionKey[] = ['microphone', 'notifications', 'bluetooth', 'nearbyDevices'];

async function browserMicrophoneState(): Promise<PermissionState> {
  try {
    const status = await navigator.permissions.query({ name: 'microphone' as PermissionName });
    if (status.state === 'granted') return 'granted';
    // A browser-level "Block" cannot be asked again from the page: that is what 'blocked' means.
    return status.state === 'denied' ? 'blocked' : 'undetermined';
  } catch {
    // Permissions API missing, or it does not know 'microphone' (Firefox, Safari): ask when it matters.
    return 'undetermined';
  }
}

async function stateOf(key: PermissionKey): Promise<PermissionState> {
  const pinned = devControls.getState().permissionOverrides[key];
  if (pinned !== undefined) return pinned;
  return key === 'microphone' ? browserMicrophoneState() : 'granted';
}

async function checkAll(): Promise<PermissionStatus> {
  const status = {} as PermissionStatus;
  for (const key of KEYS) status[key] = await stateOf(key);
  return status;
}

async function requestMicrophone(): Promise<void> {
  if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) return;
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    for (const track of stream.getTracks()) track.stop(); // only the permission was wanted, not the audio
  } catch {
    // Refused or no device: check() reports the resulting state.
  }
}

export function createPermissionService(): PermissionService {
  return {
    check: checkAll,
    async request(keys: PermissionKey[]): Promise<PermissionStatus> {
      const requested = new Set(keys);
      if (
        requested.has('microphone') &&
        devControls.getState().permissionOverrides.microphone === undefined
      ) {
        await requestMicrophone();
      }
      return checkAll();
    },
    async openSettings(): Promise<void> {
      devControls.reportOpenSettings();
    },
  };
}
