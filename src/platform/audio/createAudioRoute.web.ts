/**
 * Web twin of createAudioRoute: a FAKE AudioRoute for the browser (DEV ONLY).
 *
 * It reports plausible state (a connected Bluetooth headset by default, earpiece and speaker as fallbacks) and
 * reacts to the dev panel: "headset disconnected" turns an active route into `no-headset`, "phone call started"
 * takes communication mode away (`status: 'failed'`, `error: 'phone-call'`). Cues are short WebAudio oscillator
 * tones. Nothing here touches real audio routing: web proves nothing about Bluetooth, SCO, LE Audio or call audio.
 */
import type { Unsubscribe } from '../../core/common/types';
import { devControls } from '../devtools/devControls.web';

import type { AudioDevice, AudioRoute, AudioRouteStartOptions, AudioRouteState, CueKind } from './AudioRoute';

/** Greppable by scripts/check-android-bundle.mjs: this string must never appear in the Android bundle. */
export const WEB_ONLY_FAKE_AUDIO_ROUTE = '@@web-only:FakeAudioRoute@@';

const HEADSET: AudioDevice = {
  id: 'web-fake-bluetooth-headset',
  kind: 'bluetooth-sco',
  name: 'Fake Bluetooth headset (web)',
  hasMic: true,
};
const EARPIECE: AudioDevice = {
  id: 'web-fake-earpiece',
  kind: 'earpiece',
  name: 'Fake earpiece (web)',
  hasMic: true,
};
const SPEAKER: AudioDevice = {
  id: 'web-fake-speaker',
  kind: 'speaker',
  name: 'Fake speaker (web)',
  hasMic: true,
};

interface Tone {
  freq: number;
  ms: number;
}

/** Distinct, short and easy to tell apart without looking: rising = good news, falling = bad news. */
const CUE_TONES: Record<CueKind, Tone[]> = {
  connected: [
    { freq: 660, ms: 110 },
    { freq: 880, ms: 170 },
  ],
  disconnected: [
    { freq: 660, ms: 110 },
    { freq: 440, ms: 200 },
  ],
  reconnecting: [
    { freq: 520, ms: 90 },
    { freq: 520, ms: 90 },
  ],
  muted: [{ freq: 400, ms: 120 }],
  unmuted: [{ freq: 800, ms: 120 }],
  'partner-muted': [{ freq: 360, ms: 80 }],
  'partner-unmuted': [{ freq: 720, ms: 80 }],
  error: [
    { freq: 300, ms: 150 },
    { freq: 220, ms: 260 },
  ],
};

const CUE_GAIN = 0.12;
const CUE_GAP_MS = 30;

type AudioContextConstructor = new () => AudioContext;

function getAudioContextConstructor(): AudioContextConstructor | null {
  const scope = globalThis as unknown as {
    AudioContext?: AudioContextConstructor;
    webkitAudioContext?: AudioContextConstructor;
  };
  return scope.AudioContext ?? scope.webkitAudioContext ?? null;
}

class WebFakeAudioRoute implements AudioRoute {
  private started = false;
  private allowFallback = false;
  private readonly listeners = new Set<(state: AudioRouteState) => void>();
  private last: AudioRouteState;
  private unwatchWorld: Unsubscribe | null = null;
  private context: AudioContext | null = null;

  constructor() {
    this.last = this.compute();
  }

  async start(options: AudioRouteStartOptions): Promise<AudioRouteState> {
    this.started = true;
    this.allowFallback = options.allowFallbackDevice;
    this.watchWorld();
    return this.refresh();
  }

  async stop(): Promise<void> {
    this.started = false;
    this.refresh();
    this.maybeUnwatchWorld();
  }

  async getState(): Promise<AudioRouteState> {
    return this.compute();
  }

  onChange(listener: (state: AudioRouteState) => void): Unsubscribe {
    this.listeners.add(listener);
    this.watchWorld();
    return () => {
      this.listeners.delete(listener);
      this.maybeUnwatchWorld();
    };
  }

  async setAllowFallback(allow: boolean): Promise<AudioRouteState> {
    this.allowFallback = allow;
    return this.refresh();
  }

  async playCue(cue: CueKind): Promise<void> {
    devControls.reportCue(cue);
    try {
      this.playTones(CUE_TONES[cue]);
    } catch {
      // Cues are best effort: a missing or blocked AudioContext must never break a ride.
    }
  }

  private compute(): AudioRouteState {
    const world = devControls.getState();
    const devices = [...(world.headsetConnected ? [HEADSET] : []), EARPIECE, SPEAKER];
    const base = { devices, headsetConnected: world.headsetConnected };
    if (!this.started) {
      return {
        ...base,
        status: 'inactive',
        communicationMode: false,
        activeDeviceId: null,
        usingFallback: false,
        error: null,
      };
    }
    if (world.phoneCallActive) {
      return {
        ...base,
        status: 'failed',
        communicationMode: false,
        activeDeviceId: null,
        usingFallback: false,
        error: 'phone-call',
      };
    }
    if (world.headsetConnected) {
      return {
        ...base,
        status: 'active',
        communicationMode: true,
        activeDeviceId: HEADSET.id,
        usingFallback: false,
        error: null,
      };
    }
    if (this.allowFallback) {
      return {
        ...base,
        status: 'active',
        communicationMode: true,
        activeDeviceId: EARPIECE.id,
        usingFallback: true,
        error: null,
      };
    }
    return {
      ...base,
      status: 'no-headset',
      communicationMode: true,
      activeDeviceId: null,
      usingFallback: false,
      error: 'No headset connected',
    };
  }

  /** Recomputes the state and notifies listeners when it changed. */
  private refresh(): AudioRouteState {
    const next = this.compute();
    const changed = JSON.stringify(next) !== JSON.stringify(this.last);
    this.last = next;
    if (changed) for (const listener of [...this.listeners]) listener(next);
    return next;
  }

  private watchWorld() {
    if (this.unwatchWorld === null) this.unwatchWorld = devControls.subscribe(() => this.refresh());
  }

  private maybeUnwatchWorld() {
    if (!this.started && this.listeners.size === 0 && this.unwatchWorld !== null) {
      this.unwatchWorld();
      this.unwatchWorld = null;
    }
  }

  /** Schedules the tones and returns at once: the cue keeps playing while the ride logic moves on. */
  private playTones(tones: Tone[]): void {
    const Constructor = getAudioContextConstructor();
    if (Constructor === null) return;
    this.context ??= new Constructor();
    const context = this.context;
    if (context.state === 'suspended') void context.resume().catch(() => undefined);

    let at = context.currentTime + 0.01;
    for (const tone of tones) {
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      oscillator.type = 'sine';
      oscillator.frequency.value = tone.freq;
      const seconds = tone.ms / 1000;
      // Short ramps avoid clicks at the edges.
      gain.gain.setValueAtTime(0, at);
      gain.gain.linearRampToValueAtTime(CUE_GAIN, at + 0.01);
      gain.gain.setValueAtTime(CUE_GAIN, at + Math.max(0.01, seconds - 0.02));
      gain.gain.linearRampToValueAtTime(0, at + seconds);
      oscillator.connect(gain).connect(context.destination);
      oscillator.start(at);
      oscillator.stop(at + seconds + 0.01);
      at += seconds + CUE_GAP_MS / 1000;
    }
  }
}

export function createAudioRoute(): AudioRoute {
  return new WebFakeAudioRoute();
}
