import type { AudioRouteState } from '../../platform/audio/AudioRoute';
import type { AudioTunables } from '../../platform/audio/AudioTunables';
import type { LinkNetworkInterface } from '../../platform/link/LinkTransport';
import type { MediaStats } from '../../platform/media/MediaEngine';
import type { BatteryInfo } from '../../platform/service/RideService';
import type { LogData, LogLevel, Logger } from '../common/types';
import type { SessionSnapshot } from '../session/types';

/**
 * Diagnostics contract. CONTRACT: owned by the lead; implementation in src/core/diagnostics is owned by
 * `core-session`. The UI (diagnostics screen, hidden debug screen) and the share action consume these.
 *
 * Hard rules: the pairing secret and the Wi-Fi passphrase never appear in logs or exports. Types here cannot
 * carry them (no PairingRecord anywhere); the Logger implementation additionally redacts by key name.
 */

export interface LogEntry {
  /** Epoch ms. */
  t: number;
  level: LogLevel;
  tag: string;
  message: string;
  data?: LogData;
}

/** Ring-buffer log persisted across app restarts (via the injected KeyValueStore adapter). */
export interface RingLog extends Logger {
  entries(): LogEntry[];
  clear(): void;
  /** Called after each append (rate-limited by the implementation), e.g. to refresh the diagnostics screen. */
  subscribe(listener: () => void): () => void;
}

export interface RingLogPersistence {
  load(): string | undefined;
  save(serialized: string): void;
}

export interface RingLogOptions {
  /** Maximum number of entries kept. Default 500. */
  capacity?: number;
  persistence?: RingLogPersistence;
  now?: () => number;
}

/** Derived rates for the diagnostics screen. */
export interface StatsSample {
  t: number;
  rttMs: number | null;
  jitterMs: number | null;
  /** Packet loss in percent over the last interval. */
  lossPct: number | null;
  bitrateOutKbps: number | null;
  bitrateInKbps: number | null;
  inputLevel: number | null;
  outputLevel: number | null;
}

/** Everything the export needs. Assembled by the app from the live sources. */
export interface DiagnosticsReportInput {
  generatedAt: number;
  appVersion: string;
  platform: string;
  osVersion: string | null;
  deviceModel: string | null;
  session: SessionSnapshot;
  interfaces: LinkNetworkInterface[];
  stats: MediaStats | null;
  sample: StatsSample | null;
  audio: AudioRouteState | null;
  battery: BatteryInfo | null;
  tunables: AudioTunables;
  log: LogEntry[];
}

/** Plain-text export for the system share sheet. Deterministic for a given input. */
export type FormatDiagnosticsReport = (input: DiagnosticsReportInput) => string;
