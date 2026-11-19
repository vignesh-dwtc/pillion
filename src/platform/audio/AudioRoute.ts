import type { Unsubscribe } from '../../core/common/types';

/**
 * AudioRoute: communication audio mode and headset selection.
 * CONTRACT: owned by the lead. Native implementation: Kotlin (`android-native`) behind a thin TS wrapper
 * (`media` owns src/platform/audio). Web: fake (`web-verify`).
 *
 * Rules (from the brief):
 *  - start(): switch to communication mode and route to the best device: Bluetooth headset first
 *    (LE Audio or SCO), then wired. API >= 31 uses setCommunicationDevice; API 29-30 use the legacy SCO calls.
 *  - Follow device changes while running (onChange). stop() restores everything.
 *  - No headset connected is an ERROR state, unless `allowFallbackDevice` (developer override for bench tests)
 *    allows earpiece/speaker.
 *  - Never hold exclusive audio focus: the rider's music and navigation must keep playing.
 */

export type AudioDeviceKind =
  'bluetooth-sco' | 'bluetooth-le' | 'wired-headset' | 'usb-headset' | 'earpiece' | 'speaker' | 'other';

export interface AudioDevice {
  id: string;
  kind: AudioDeviceKind;
  name: string;
  /** Has a usable microphone in communication mode. */
  hasMic: boolean;
}

export type AudioRouteStatus =
  | 'inactive' // not started
  | 'active' // communication mode on, routed to a headset (or an allowed fallback)
  | 'no-headset' // started, but no acceptable device and fallback not allowed
  | 'failed';

export interface AudioRouteState {
  status: AudioRouteStatus;
  communicationMode: boolean;
  devices: AudioDevice[];
  activeDeviceId: string | null;
  headsetConnected: boolean;
  /** True when routed to earpiece/speaker because the developer override allowed it. */
  usingFallback: boolean;
  error: string | null;
}

export interface AudioRouteStartOptions {
  /** Developer override: allow earpiece/speaker when no headset is connected. */
  allowFallbackDevice: boolean;
}

/** Short audio cues; nobody is looking at the screen. M1 needs `connected` and `disconnected`. */
export type CueKind =
  | 'connected'
  | 'disconnected'
  | 'reconnecting'
  | 'muted'
  | 'unmuted'
  | 'partner-muted'
  | 'partner-unmuted'
  | 'error';

export interface AudioRoute {
  start(options: AudioRouteStartOptions): Promise<AudioRouteState>;
  stop(): Promise<void>;
  getState(): Promise<AudioRouteState>;
  onChange(listener: (state: AudioRouteState) => void): Unsubscribe;
  setAllowFallback(allow: boolean): Promise<AudioRouteState>;
  /** Plays through the current communication device (USAGE_VOICE_COMMUNICATION), not the media stream. */
  playCue(cue: CueKind): Promise<void>;
}
