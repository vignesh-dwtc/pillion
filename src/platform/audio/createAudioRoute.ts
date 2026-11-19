/**
 * Native AudioRoute: a thin wrapper over the local Expo module `IntercomAudioRoute` (Kotlin, owned by
 * `android-native`; JS surface in specs/IntercomAudioRoute.ts). The web twin is `createAudioRoute.web.ts` (fake).
 *
 * What the wrapper adds on top of the native module:
 *   - fails clearly when the module is missing (an APK built without it, Expo Go, an iOS build) or has a different
 *     API version: every call rejects with `AudioRouteUnavailableError` naming the cause, `onChange` is a no-op;
 *   - normalises every state snapshot to the frozen `AudioRouteState` (drops the native-only `wouldChoose`,
 *     defends against missing or malformed fields so a native bug cannot crash the session layer);
 *   - native errors (`ERR_AUDIO_PERMISSION`, `ERR_AUDIO_ROUTE`, `ERR_NOT_IMPLEMENTED`) pass through unchanged, so the
 *     session layer keeps their `code`.
 *
 * Compiles and unit-tested (Jest, mocked module), untested on device.
 */
import type { Unsubscribe } from '../../core/common/types';
import {
  getIntercomAudioRouteModule,
  INTERCOM_AUDIO_ROUTE_API_VERSION,
  INTERCOM_AUDIO_ROUTE_MODULE_NAME,
  type IntercomAudioRouteNativeModule,
  type NativeAudioRouteState,
} from '../../../specs/IntercomAudioRoute';

import type {
  AudioDevice,
  AudioDeviceKind,
  AudioRoute,
  AudioRouteStartOptions,
  AudioRouteState,
  AudioRouteStatus,
  CueKind,
} from './AudioRoute';

export class AudioRouteUnavailableError extends Error {
  readonly code = 'ERR_AUDIO_ROUTE_UNAVAILABLE';
  constructor(message: string) {
    super(message);
    this.name = 'AudioRouteUnavailableError';
  }
}

const DEVICE_KINDS: readonly AudioDeviceKind[] = [
  'bluetooth-sco',
  'bluetooth-le',
  'wired-headset',
  'usb-headset',
  'earpiece',
  'speaker',
  'other',
];
const STATUSES: readonly AudioRouteStatus[] = ['inactive', 'active', 'no-headset', 'failed'];

function toDevice(raw: unknown): AudioDevice | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const d = raw as Record<string, unknown>;
  const id = typeof d.id === 'string' ? d.id : typeof d.id === 'number' ? String(d.id) : null;
  if (id === null) return null;
  const kind = DEVICE_KINDS.includes(d.kind as AudioDeviceKind) ? (d.kind as AudioDeviceKind) : 'other';
  return { id, kind, name: typeof d.name === 'string' ? d.name : kind, hasMic: d.hasMic === true };
}

/** Native snapshot -> the frozen contract type. Never throws. */
export function toAudioRouteState(raw: NativeAudioRouteState | unknown): AudioRouteState {
  if (typeof raw !== 'object' || raw === null) {
    return {
      status: 'failed',
      communicationMode: false,
      devices: [],
      activeDeviceId: null,
      headsetConnected: false,
      usingFallback: false,
      error: 'malformed audio route state from the native module',
    };
  }
  const s = raw as Record<string, unknown>;
  const devices = Array.isArray(s.devices)
    ? s.devices.map(toDevice).filter((d): d is AudioDevice => d !== null)
    : [];
  const status = STATUSES.includes(s.status as AudioRouteStatus) ? (s.status as AudioRouteStatus) : 'failed';
  return {
    status,
    communicationMode: s.communicationMode === true,
    devices,
    activeDeviceId: typeof s.activeDeviceId === 'string' ? s.activeDeviceId : null,
    headsetConnected: s.headsetConnected === true,
    usingFallback: s.usingFallback === true,
    error:
      typeof s.error === 'string'
        ? s.error
        : status === 'failed' && s.status !== 'failed'
          ? `unknown status '${String(s.status)}'`
          : null,
  };
}

/** Why the module cannot be used, or null when it can. */
export function unavailableReason(module: IntercomAudioRouteNativeModule | null): string | null {
  if (module === null) {
    return `native module ${INTERCOM_AUDIO_ROUTE_MODULE_NAME} is missing: this build does not include modules/intercom-native (rebuild the app)`;
  }
  const version: unknown = (module as { API_VERSION?: unknown }).API_VERSION;
  if (typeof version === 'number' && version !== INTERCOM_AUDIO_ROUTE_API_VERSION) {
    return `native module ${INTERCOM_AUDIO_ROUTE_MODULE_NAME} has API version ${version}, the app expects ${INTERCOM_AUDIO_ROUTE_API_VERSION} (rebuild the app)`;
  }
  return null;
}

class NativeAudioRoute implements AudioRoute {
  constructor(private readonly native: IntercomAudioRouteNativeModule) {}

  async start(options: AudioRouteStartOptions): Promise<AudioRouteState> {
    return toAudioRouteState(
      await this.native.start({ allowFallbackDevice: options.allowFallbackDevice === true }),
    );
  }

  async stop(): Promise<void> {
    await this.native.stop();
  }

  async getState(): Promise<AudioRouteState> {
    return toAudioRouteState(await this.native.getState());
  }

  onChange(listener: (state: AudioRouteState) => void): Unsubscribe {
    const subscription = this.native.addListener('onChange', (state) => listener(toAudioRouteState(state)));
    let removed = false;
    return () => {
      if (removed) return;
      removed = true;
      subscription.remove();
    };
  }

  async setAllowFallback(allow: boolean): Promise<AudioRouteState> {
    return toAudioRouteState(await this.native.setAllowFallback(allow === true));
  }

  async playCue(cue: CueKind): Promise<void> {
    await this.native.playCue(cue);
  }
}

class UnavailableAudioRoute implements AudioRoute {
  constructor(private readonly reason: string) {}

  private fail(): Promise<never> {
    return Promise.reject(new AudioRouteUnavailableError(this.reason));
  }

  start(): Promise<AudioRouteState> {
    return this.fail();
  }

  /** Nothing was changed, so there is nothing to restore: stop stays idempotent and safe in finally paths. */
  async stop(): Promise<void> {}

  getState(): Promise<AudioRouteState> {
    return this.fail();
  }

  onChange(): Unsubscribe {
    return () => undefined;
  }

  setAllowFallback(): Promise<AudioRouteState> {
    return this.fail();
  }

  playCue(): Promise<void> {
    return this.fail();
  }
}

/** For tests and for callers that already hold the module. */
export function createAudioRouteFromModule(module: IntercomAudioRouteNativeModule | null): AudioRoute {
  const reason = unavailableReason(module);
  return reason !== null || module === null
    ? new UnavailableAudioRoute(reason ?? 'missing module')
    : new NativeAudioRoute(module);
}

export function createAudioRoute(): AudioRoute {
  return createAudioRouteFromModule(getIntercomAudioRouteModule());
}
