/**
 * DevControls: the web-only registry behind the dev panel (DEV ONLY, never part of the Android bundle).
 *
 * It holds the state of the PRETEND world around the web fakes (is a headset connected, is a phone call ringing,
 * is the link blocked, what is the battery) and the typed commands that change it. The fakes
 * (`createAudioRoute.web.ts`, `createLinkTransport.web.ts`, `createRideService.web.ts`,
 * `createPermissionService.web.ts`) read that state and react; the dev panel (`DevPanel.web.tsx`) and Playwright
 * call the commands. Keeping the world here (instead of inside one fake instance) means the panel works before a
 * ride starts, survives a fake being created twice, and lets a test pre-arrange "headset unplugged" before tapping Start.
 *
 * Playwright can also reach the registry as `window.__devControls`.
 *
 * Web proves nothing about real Bluetooth, telephony or radios: these are switches for the UI and the state machine.
 */
import type { Unsubscribe } from '../../core/common/types';
import type { CueKind } from '../audio/AudioRoute';
import type { PermissionKey, PermissionState } from '../permissions/PermissionService';
import type { BatteryInfo, RideServiceAction } from '../service/RideService';

/** Greppable by scripts/check-android-bundle.mjs: this string must never appear in the Android bundle. */
export const WEB_ONLY_DEV_CONTROLS = '@@web-only:DevControls@@';

export interface DevControlsState {
  /** A (fake) Bluetooth headset is connected. Default true. */
  headsetConnected: boolean;
  /** A (fake) phone call is in progress: the fake AudioRoute loses communication mode (`error: 'phone-call'`). */
  phoneCallActive: boolean;
  /** While true the fake link transport refuses open() with LinkError('unavailable'): holds the session in `reconnecting`. */
  linkBlocked: boolean;
  /** A link channel is currently established (reported by the web link transport). */
  linkUp: boolean;
  /** What the fake RideService reports as battery; null = unavailable. */
  battery: BatteryInfo | null;
  /** Last audio cue the fake AudioRoute "played", and how many it has played since the page loaded. */
  lastCue: CueKind | null;
  cueCount: number;
  /** Fixed answers for PermissionService.check()/request(); a missing key means "ask the browser / granted". */
  permissionOverrides: Partial<Record<PermissionKey, PermissionState>>;
  /** How many times PermissionService.openSettings() was called (web has no system settings screen). */
  openSettingsCount: number;
}

export interface DevControls {
  /** Immutable snapshot; a new object after every change (safe for useSyncExternalStore). */
  getState(): DevControlsState;
  subscribe(listener: () => void): Unsubscribe;

  // Commands: the dev panel and Playwright call these.
  setHeadsetConnected(connected: boolean): void;
  setPhoneCallActive(active: boolean): void;
  /** Closes every established link as if the radio had dropped (both ends see the link end). */
  dropLink(): void;
  setLinkBlocked(blocked: boolean): void;
  /** Simulates a press of a notification button. */
  pressRideServiceAction(action: RideServiceAction): void;
  setBattery(battery: BatteryInfo | null): void;
  overridePermission(key: PermissionKey, state: PermissionState | null): void;
  /** Back to the defaults (tests). */
  reset(): void;

  // Hooks for the web fakes (not for the panel).
  onDropLink(listener: () => void): Unsubscribe;
  onRideServiceAction(listener: (action: RideServiceAction) => void): Unsubscribe;
  reportLinkUp(up: boolean): void;
  reportCue(cue: CueKind): void;
  reportOpenSettings(): void;
}

function initialState(): DevControlsState {
  return {
    headsetConnected: true,
    phoneCallActive: false,
    linkBlocked: false,
    linkUp: false,
    battery: { levelPct: 80, charging: false },
    lastCue: null,
    cueCount: 0,
    permissionOverrides: {},
    openSettingsCount: 0,
  };
}

function createDevControls(): DevControls {
  let state = initialState();
  const listeners = new Set<() => void>();
  const dropListeners = new Set<() => void>();
  const actionListeners = new Set<(action: RideServiceAction) => void>();

  const update = (patch: Partial<DevControlsState>) => {
    state = { ...state, ...patch };
    for (const listener of [...listeners]) listener();
  };

  return {
    getState: () => state,
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    setHeadsetConnected: (connected) => update({ headsetConnected: connected }),
    setPhoneCallActive: (active) => update({ phoneCallActive: active }),
    dropLink() {
      for (const listener of [...dropListeners]) listener();
    },
    setLinkBlocked: (blocked) => update({ linkBlocked: blocked }),
    pressRideServiceAction(action) {
      for (const listener of [...actionListeners]) listener(action);
    },
    setBattery: (battery) => update({ battery }),
    overridePermission(key, value) {
      const next = { ...state.permissionOverrides };
      if (value === null) delete next[key];
      else next[key] = value;
      update({ permissionOverrides: next });
    },
    reset: () => update(initialState()),
    onDropLink(listener) {
      dropListeners.add(listener);
      return () => {
        dropListeners.delete(listener);
      };
    },
    onRideServiceAction(listener) {
      actionListeners.add(listener);
      return () => {
        actionListeners.delete(listener);
      };
    },
    reportLinkUp: (up) => {
      if (state.linkUp !== up) update({ linkUp: up });
    },
    reportCue: (cue) => update({ lastCue: cue, cueCount: state.cueCount + 1 }),
    reportOpenSettings: () => update({ openSettingsCount: state.openSettingsCount + 1 }),
  };
}

/** One registry per page (module singleton). */
export const devControls: DevControls = createDevControls();

if (typeof globalThis !== 'undefined') {
  (globalThis as Record<string, unknown>).__devControls = devControls;
}
