import type {
  AudioDevice,
  AudioRoute,
  AudioRouteStartOptions,
  AudioRouteState,
  CueKind,
} from '../../../platform/audio/AudioRoute';
import type { Unsubscribe } from '../../common/types';

/**
 * Fake `AudioRoute`: reports plausible state, follows a headset that the test connects and disconnects, records
 * every call and cue, and can fail or hang on command (a cue that throws must never break a ride).
 */

const HEADSET: AudioDevice = { id: 'bt-1', kind: 'bluetooth-sco', name: 'Test earbuds', hasMic: true };
const EARPIECE: AudioDevice = { id: 'earpiece-1', kind: 'earpiece', name: 'Earpiece', hasMic: true };

export class FakeAudioRoute implements AudioRoute {
  readonly cues: CueKind[] = [];
  readonly calls: string[] = [];
  startCalls = 0;
  stopCalls = 0;
  lastStartOptions: AudioRouteStartOptions | null = null;

  private running = false;
  private allowFallback = false;
  private headsetConnected: boolean;
  private startFailure: unknown = null;
  private startHang = false;
  private cueFailure: 'none' | 'throw' | 'reject' | 'hang' = 'none';
  private readonly listeners = new Set<(state: AudioRouteState) => void>();

  constructor(options: { headsetConnected?: boolean } = {}) {
    this.headsetConnected = options.headsetConnected ?? true;
  }

  async start(options: AudioRouteStartOptions): Promise<AudioRouteState> {
    this.startCalls += 1;
    this.calls.push('start');
    this.lastStartOptions = options;
    this.allowFallback = options.allowFallbackDevice;
    if (this.startHang) return new Promise<AudioRouteState>(() => undefined);
    if (this.startFailure !== null) throw this.startFailure;
    this.running = true;
    return this.state();
  }

  async stop(): Promise<void> {
    this.stopCalls += 1;
    this.calls.push('stop');
    this.running = false;
  }

  async getState(): Promise<AudioRouteState> {
    return this.state();
  }

  onChange(listener: (state: AudioRouteState) => void): Unsubscribe {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  async setAllowFallback(allow: boolean): Promise<AudioRouteState> {
    this.allowFallback = allow;
    this.emit();
    return this.state();
  }

  playCue(cue: CueKind): Promise<void> {
    this.cues.push(cue);
    switch (this.cueFailure) {
      case 'throw':
        throw new Error('cue player crashed');
      case 'reject':
        return Promise.reject(new Error('cue player failed'));
      case 'hang':
        return new Promise<void>(() => undefined);
      default:
        return Promise.resolve();
    }
  }

  // ---- test controls ----------------------------------------------------------------------------------

  get isRunning(): boolean {
    return this.running;
  }

  get listenerCount(): number {
    return this.listeners.size;
  }

  /** The user connects or disconnects the earbuds; running listeners are told, like the platform would. */
  setHeadsetConnected(connected: boolean): void {
    this.headsetConnected = connected;
    this.emit();
  }

  failStart(error: unknown = new Error('audio manager unavailable')): void {
    this.startFailure = error;
  }

  hangStart(on = true): void {
    this.startHang = on;
  }

  /** How playCue misbehaves: throws synchronously, returns a rejected promise, or never settles. */
  setCueFailure(mode: 'none' | 'throw' | 'reject' | 'hang'): void {
    this.cueFailure = mode;
  }

  private state(): AudioRouteState {
    if (!this.running) {
      return {
        status: 'inactive',
        communicationMode: false,
        devices: this.headsetConnected ? [HEADSET] : [],
        activeDeviceId: null,
        headsetConnected: this.headsetConnected,
        usingFallback: false,
        error: null,
      };
    }
    if (this.headsetConnected) {
      return {
        status: 'active',
        communicationMode: true,
        devices: [HEADSET],
        activeDeviceId: HEADSET.id,
        headsetConnected: true,
        usingFallback: false,
        error: null,
      };
    }
    if (this.allowFallback) {
      return {
        status: 'active',
        communicationMode: true,
        devices: [EARPIECE],
        activeDeviceId: EARPIECE.id,
        headsetConnected: false,
        usingFallback: true,
        error: null,
      };
    }
    return {
      status: 'no-headset',
      communicationMode: true,
      devices: [],
      activeDeviceId: null,
      headsetConnected: false,
      usingFallback: false,
      error: null,
    };
  }

  private emit(): void {
    if (!this.running) return;
    const state = this.state();
    for (const listener of [...this.listeners]) listener(state);
  }
}
