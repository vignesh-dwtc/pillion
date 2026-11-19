/**
 * Pure helpers around the frozen `AudioTunables` contract: validation/clamping, the getUserMedia constraint mapping
 * and a one-line description for the diagnostics export. No react-native / DOM imports: shared by the native engine
 * and the web twin, and unit-tested in plain Node.
 */
import { AUDIO_TUNABLE_LIMITS, DEFAULT_AUDIO_TUNABLES, type AudioTunables } from './AudioTunables';

type PacketTime = AudioTunables['opusPacketTimeMs'];

function pickBoolean(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

function pickBitrate(value: unknown, fallback: number): number {
  // Strings, NaN, +-Infinity and everything else that is not a finite number fall back to the default.
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
  const { min, max } = AUDIO_TUNABLE_LIMITS.opusBitrateBps;
  return Math.min(max, Math.max(min, Math.round(value)));
}

/** Snaps to the nearest allowed packet time; a tie goes to the shorter one (lower latency). */
function pickPacketTime(value: unknown, fallback: PacketTime): PacketTime {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
  let best: PacketTime = AUDIO_TUNABLE_LIMITS.opusPacketTimeMs[0];
  for (const candidate of AUDIO_TUNABLE_LIMITS.opusPacketTimeMs) {
    if (Math.abs(candidate - value) < Math.abs(best - value)) best = candidate;
  }
  return best;
}

/**
 * Builds a valid `AudioTunables` from anything: a partial object, a stored (possibly stale or corrupt) blob, or
 * garbage. Never throws. Unknown keys are dropped, invalid values fall back to `base` (default: the defaults),
 * numbers are clamped to `AUDIO_TUNABLE_LIMITS`, packet time snaps to the allowed set.
 */
export function clampTunables(
  partial?: unknown,
  base: AudioTunables = DEFAULT_AUDIO_TUNABLES,
): AudioTunables {
  const source: Record<string, unknown> =
    typeof partial === 'object' && partial !== null && !Array.isArray(partial)
      ? (partial as Record<string, unknown>)
      : {};
  const get = (key: keyof AudioTunables): unknown => {
    try {
      return Object.prototype.hasOwnProperty.call(source, key) ? source[key] : undefined;
    } catch {
      return undefined; // a throwing getter is still garbage, not an error
    }
  };
  return {
    noiseSuppression: pickBoolean(get('noiseSuppression'), base.noiseSuppression),
    autoGainControl: pickBoolean(get('autoGainControl'), base.autoGainControl),
    echoCancellation: pickBoolean(get('echoCancellation'), base.echoCancellation),
    highpassFilter: pickBoolean(get('highpassFilter'), base.highpassFilter),
    opusBitrateBps: pickBitrate(get('opusBitrateBps'), pickBitrate(base.opusBitrateBps, 24_000)),
    opusFec: pickBoolean(get('opusFec'), base.opusFec),
    opusDtx: pickBoolean(get('opusDtx'), base.opusDtx),
    opusPacketTimeMs: pickPacketTime(get('opusPacketTimeMs'), pickPacketTime(base.opusPacketTimeMs, 20)),
  };
}

/**
 * Audio constraints for getUserMedia. Names verified against the installed `@livekit/react-native-webrtc` 150.1.1:
 * android/.../GetUserMediaImpl.java `createAudioTrack` reads exactly `autoGainControl`, `noiseSuppression`,
 * `echoCancellation` and `highpassFilter` (the last is a LiveKit-fork extension; it maps to `googHighpassFilter`)
 * and defaults each to "true". Nothing else (channelCount, sampleRate, ...) is read on Android, and every key
 * present is also forwarded as a mandatory constraint, so on `native` only these four keys are emitted.
 * `web` targets a browser: the standard three plus `channelCount: 1`; `highpassFilter` has no standard constraint.
 */
export interface NativeAudioConstraints {
  echoCancellation: boolean;
  noiseSuppression: boolean;
  autoGainControl: boolean;
  highpassFilter: boolean;
}

export interface WebAudioConstraints {
  channelCount: 1;
  echoCancellation: boolean;
  noiseSuppression: boolean;
  autoGainControl: boolean;
}

export function toGetUserMediaConstraints(tunables: AudioTunables): NativeAudioConstraints;
export function toGetUserMediaConstraints(tunables: AudioTunables, target: 'native'): NativeAudioConstraints;
export function toGetUserMediaConstraints(tunables: AudioTunables, target: 'web'): WebAudioConstraints;
export function toGetUserMediaConstraints(
  tunables: AudioTunables,
  target: 'native' | 'web' = 'native',
): NativeAudioConstraints | WebAudioConstraints {
  const t = clampTunables(tunables);
  if (target === 'web') {
    return {
      channelCount: 1,
      echoCancellation: t.echoCancellation,
      noiseSuppression: t.noiseSuppression,
      autoGainControl: t.autoGainControl,
    };
  }
  return {
    echoCancellation: t.echoCancellation,
    noiseSuppression: t.noiseSuppression,
    autoGainControl: t.autoGainControl,
    highpassFilter: t.highpassFilter,
  };
}

/** True when two tunables differ in a field that needs a new microphone track (constraints cannot change live). */
export function captureConstraintsDiffer(a: AudioTunables, b: AudioTunables): boolean {
  return (
    a.echoCancellation !== b.echoCancellation ||
    a.noiseSuppression !== b.noiseSuppression ||
    a.autoGainControl !== b.autoGainControl ||
    a.highpassFilter !== b.highpassFilter
  );
}

/** One line for the diagnostics export, e.g. `ns=on agc=on aec=on hpf=on opus=24000bps fec=on dtx=off ptime=20ms`. */
export function describeTunables(tunables: AudioTunables): string {
  const t = clampTunables(tunables);
  const flag = (value: boolean) => (value ? 'on' : 'off');
  return [
    `ns=${flag(t.noiseSuppression)}`,
    `agc=${flag(t.autoGainControl)}`,
    `aec=${flag(t.echoCancellation)}`,
    `hpf=${flag(t.highpassFilter)}`,
    `opus=${t.opusBitrateBps}bps`,
    `fec=${flag(t.opusFec)}`,
    `dtx=${flag(t.opusDtx)}`,
    `ptime=${t.opusPacketTimeMs}ms`,
  ].join(' ');
}
