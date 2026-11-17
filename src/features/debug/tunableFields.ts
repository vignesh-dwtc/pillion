import {
  AUDIO_TUNABLE_LIMITS,
  DEFAULT_AUDIO_TUNABLES,
  type AudioTunables,
} from '../../platform/audio/AudioTunables';
import { strings } from '../../app/strings';

/** Pure helpers behind the debug screen's audio tunables editor. */

export type BooleanTunable =
  'noiseSuppression' | 'autoGainControl' | 'echoCancellation' | 'highpassFilter' | 'opusFec' | 'opusDtx';

/** Order of the on/off switches on screen: processing first, then the Opus options. */
export const PROCESSING_TUNABLES: readonly BooleanTunable[] = [
  'noiseSuppression',
  'autoGainControl',
  'echoCancellation',
  'highpassFilter',
];
export const OPUS_TUNABLES: readonly BooleanTunable[] = ['opusFec', 'opusDtx'];

/** Fine adjustment of the Opus bitrate (the big presets cover the coarse jumps). */
export const BITRATE_STEP_BPS = 2_000;

const { min: BITRATE_MIN, max: BITRATE_MAX } = AUDIO_TUNABLE_LIMITS.opusBitrateBps;

export const BITRATE_PRESETS: readonly number[] = [8_000, 16_000, 24_000, 32_000, 48_000, 64_000].filter(
  (bps) => bps >= BITRATE_MIN && bps <= BITRATE_MAX,
);

/** Next bitrate one step up or down, clamped to AUDIO_TUNABLE_LIMITS. */
export function stepBitrate(current: number, direction: 1 | -1): number {
  return Math.min(BITRATE_MAX, Math.max(BITRATE_MIN, current + direction * BITRATE_STEP_BPS));
}

export const TUNABLE_COPY: Record<keyof AudioTunables, { label: string; hint: string }> = {
  noiseSuppression: strings.debug.noiseSuppression,
  autoGainControl: strings.debug.autoGainControl,
  echoCancellation: strings.debug.echoCancellation,
  highpassFilter: strings.debug.highpassFilter,
  opusBitrateBps: strings.debug.opusBitrate,
  opusFec: strings.debug.opusFec,
  opusDtx: strings.debug.opusDtx,
  opusPacketTimeMs: strings.debug.opusPacketTime,
};

/** Fields whose value differs from DEFAULT_AUDIO_TUNABLES, in a stable order. */
export function changedTunables(tunables: AudioTunables): (keyof AudioTunables)[] {
  return (Object.keys(DEFAULT_AUDIO_TUNABLES) as (keyof AudioTunables)[]).filter(
    (key) => tunables[key] !== DEFAULT_AUDIO_TUNABLES[key],
  );
}
