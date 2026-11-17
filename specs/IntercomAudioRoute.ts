import { NativeModule, requireOptionalNativeModule } from 'expo';

/**
 * JS surface of the native module `IntercomAudioRoute` (Kotlin class IntercomAudioRouteModule). The TypeScript wrapper
 * (src/platform/audio, owned by `media`) adapts it to the frozen `AudioRoute` interface.
 *
 * Types in this file are structurally identical to AudioRoute.ts (`AudioDevice`, `AudioRouteState`, `CueKind`); they are
 * declared again here so the native contract does not import platform code.
 *
 * Behaviour (implemented in M1; M0 only provides `getInfo` and a read-only `getState`):
 *  - start: set AudioManager mode to MODE_IN_COMMUNICATION and route to the best device by the selection policy (Bluetooth
 *    LE Audio / SCO, then wired / USB; earpiece / speaker only with `allowFallbackDevice`). API 31+: setCommunicationDevice
 *    with a device from getAvailableCommunicationDevices(); API 29-30: startBluetoothSco / setBluetoothScoOn. Never requests
 *    audio focus (the rider's music and navigation keep playing). Everything it changed is restored by `stop`.
 *  - `onChange` fires on device add/remove (AudioDeviceCallback) and when routing changes; the payload is the full state.
 *
 * THREADING. Async functions run on the Expo module queue. AudioManager callbacks are registered on a dedicated handler
 * thread; `onChange` is emitted from there. Events are state snapshots (idempotent), delivered in order.
 *
 * ERRORS. ERR_NOT_IMPLEMENTED (M0) or ERR_AUDIO_PERMISSION (BLUETOOTH_CONNECT missing on API 31+) / ERR_AUDIO_ROUTE.
 * "No headset" is not an error: it is `status: 'no-headset'` in the resolved state.
 */

export const INTERCOM_AUDIO_ROUTE_MODULE_NAME = 'IntercomAudioRoute';
export const INTERCOM_AUDIO_ROUTE_API_VERSION = 1;

export type NativeAudioDeviceKind =
  'bluetooth-sco' | 'bluetooth-le' | 'wired-headset' | 'usb-headset' | 'earpiece' | 'speaker' | 'other';

export interface NativeAudioDevice {
  /** AudioDeviceInfo.getId() as a string. Stable while the device stays connected. */
  id: string;
  kind: NativeAudioDeviceKind;
  name: string;
  hasMic: boolean;
}

export type NativeAudioRouteStatus = 'inactive' | 'active' | 'no-headset' | 'failed';

export interface NativeAudioRouteState {
  status: NativeAudioRouteStatus;
  communicationMode: boolean;
  devices: NativeAudioDevice[];
  activeDeviceId: string | null;
  headsetConnected: boolean;
  usingFallback: boolean;
  error: string | null;
  /** Diagnostic: the device the policy would pick now without the fallback (null when none). Only in `getState`. */
  wouldChoose?: string | null;
}

export interface NativeAudioStartOptions {
  allowFallbackDevice: boolean;
}

export type NativeCueKind =
  | 'connected'
  | 'disconnected'
  | 'reconnecting'
  | 'muted'
  | 'unmuted'
  | 'partner-muted'
  | 'partner-unmuted'
  | 'error';

export interface AudioRouteModuleInfo {
  apiVersion: number;
  sdkInt: number;
}

export type IntercomAudioRouteEvents = {
  /** Full state snapshot after any device or routing change. */
  onChange(state: NativeAudioRouteState): void;
};

export declare class IntercomAudioRouteNativeModule extends NativeModule<IntercomAudioRouteEvents> {
  readonly API_VERSION: number;

  getInfo(): Promise<AudioRouteModuleInfo>;
  /** M0: read-only snapshot (`status: 'inactive'`). M1: current state of the running route. */
  getState(): Promise<NativeAudioRouteState>;
  start(options: NativeAudioStartOptions): Promise<NativeAudioRouteState>;
  /** Restores mode, communication device, SCO and speakerphone to what they were before `start`. Idempotent. */
  stop(): Promise<void>;
  setAllowFallback(allow: boolean): Promise<NativeAudioRouteState>;
  /** Plays a short cue (USAGE_VOICE_COMMUNICATION) through the current communication device; resolves when playback ends. */
  playCue(cue: NativeCueKind): Promise<void>;
}

export function getIntercomAudioRouteModule(): IntercomAudioRouteNativeModule | null {
  return requireOptionalNativeModule<IntercomAudioRouteNativeModule>(INTERCOM_AUDIO_ROUTE_MODULE_NAME);
}
