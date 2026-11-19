import {
  AUDIO_TUNABLE_LIMITS,
  DEFAULT_AUDIO_TUNABLES,
  type AudioTunables,
} from '../platform/audio/AudioTunables';
import type { KeyValueStore } from '../platform/storage/stores';

/**
 * What the app persists through the KeyValueStore port, and how it is read back defensively: a corrupt or
 * hand-edited value must never crash the app or push a tunable outside AUDIO_TUNABLE_LIMITS. Pure TypeScript.
 * Keys carry a format version; an incompatible change uses a new key and migrates.
 */

export const SETTINGS_KEY = 'settings.v1';
export const TUNABLES_KEY = 'audio.tunables.v1';

/** The pairing payload allows a host display name of 1..24 characters after trimming. */
export const DEVICE_NAME_MAX_LENGTH = 24;

export interface AppSettings {
  /** This phone's display name, sent to the partner in peer-state. */
  deviceName: string;
  /** Runtime developer mode (7 taps on the version label); not tied to __DEV__ (DECISIONS D-022). */
  developerMode: boolean;
  /** Developer override: allow earpiece/speaker when no headset is connected. Only effective in developer mode. */
  allowNoHeadset: boolean;
  /** The first-run onboarding has been completed (or skipped by pairing). */
  onboardingDone: boolean;
}

export function defaultSettings(defaultDeviceName: string): AppSettings {
  return {
    deviceName: sanitizeDeviceName(defaultDeviceName, 'Phone'),
    developerMode: false,
    allowNoHeadset: false,
    onboardingDone: false,
  };
}

/** Trims, drops control characters and cuts to DEVICE_NAME_MAX_LENGTH code points; falls back when empty. */
export function sanitizeDeviceName(raw: string, fallback: string): string {
  const cleaned = raw.replace(/[\u0000-\u001F\u007F]/g, '').trim();
  const clipped = Array.from(cleaned).slice(0, DEVICE_NAME_MAX_LENGTH).join('').trim();
  return clipped.length > 0 ? clipped : fallback;
}

export function clampBitrate(value: number): number {
  const { min, max } = AUDIO_TUNABLE_LIMITS.opusBitrateBps;
  if (!Number.isFinite(value)) return DEFAULT_AUDIO_TUNABLES.opusBitrateBps;
  return Math.min(max, Math.max(min, Math.round(value)));
}

function asBoolean(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

function asPacketTime(
  value: unknown,
  fallback: AudioTunables['opusPacketTimeMs'],
): AudioTunables['opusPacketTimeMs'] {
  return AUDIO_TUNABLE_LIMITS.opusPacketTimeMs.find((allowed) => allowed === value) ?? fallback;
}

/** Field-by-field validation of an untrusted object into a complete, in-limits AudioTunables. */
export function sanitizeTunables(
  input: unknown,
  base: AudioTunables = DEFAULT_AUDIO_TUNABLES,
): AudioTunables {
  const source = typeof input === 'object' && input !== null ? (input as Record<string, unknown>) : {};
  return {
    noiseSuppression: asBoolean(source.noiseSuppression, base.noiseSuppression),
    autoGainControl: asBoolean(source.autoGainControl, base.autoGainControl),
    echoCancellation: asBoolean(source.echoCancellation, base.echoCancellation),
    highpassFilter: asBoolean(source.highpassFilter, base.highpassFilter),
    opusBitrateBps:
      typeof source.opusBitrateBps === 'number' ? clampBitrate(source.opusBitrateBps) : base.opusBitrateBps,
    opusFec: asBoolean(source.opusFec, base.opusFec),
    opusDtx: asBoolean(source.opusDtx, base.opusDtx),
    opusPacketTimeMs: asPacketTime(source.opusPacketTimeMs, base.opusPacketTimeMs),
  };
}

export function tunablesEqual(a: AudioTunables, b: AudioTunables): boolean {
  return (
    a.noiseSuppression === b.noiseSuppression &&
    a.autoGainControl === b.autoGainControl &&
    a.echoCancellation === b.echoCancellation &&
    a.highpassFilter === b.highpassFilter &&
    a.opusBitrateBps === b.opusBitrateBps &&
    a.opusFec === b.opusFec &&
    a.opusDtx === b.opusDtx &&
    a.opusPacketTimeMs === b.opusPacketTimeMs
  );
}

function parseJson(raw: string | undefined): unknown {
  if (raw === undefined) return undefined;
  try {
    return JSON.parse(raw);
  } catch {
    return undefined;
  }
}

export function parseSettings(raw: string | undefined, defaults: AppSettings): AppSettings {
  const value = parseJson(raw);
  const source = typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {};
  const developerMode = asBoolean(source.developerMode, defaults.developerMode);
  return {
    deviceName:
      typeof source.deviceName === 'string'
        ? sanitizeDeviceName(source.deviceName, defaults.deviceName)
        : defaults.deviceName,
    developerMode,
    // The override can never be on without developer mode, even in a hand-edited value.
    allowNoHeadset: developerMode && asBoolean(source.allowNoHeadset, defaults.allowNoHeadset),
    onboardingDone: asBoolean(source.onboardingDone, defaults.onboardingDone),
  };
}

export function loadSettings(kv: KeyValueStore, defaults: AppSettings): AppSettings {
  return parseSettings(kv.getString(SETTINGS_KEY), defaults);
}

export function saveSettings(kv: KeyValueStore, settings: AppSettings): void {
  kv.setString(SETTINGS_KEY, JSON.stringify(settings));
}

export function loadTunables(kv: KeyValueStore): AudioTunables {
  return sanitizeTunables(parseJson(kv.getString(TUNABLES_KEY)));
}

export function saveTunables(kv: KeyValueStore, tunables: AudioTunables): void {
  kv.setString(TUNABLES_KEY, JSON.stringify(tunables));
}
