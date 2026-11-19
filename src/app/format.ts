import { strings } from './strings';

/** Small, pure formatters shared by the diagnostics and debug screens. `null` always renders as "n/a". */

const NA = strings.common.notAvailable;

export function formatKbps(bitsPerSecond: number | null): string {
  if (bitsPerSecond === null) return NA;
  const kbps = bitsPerSecond / 1000;
  return `${Number.isInteger(kbps) ? kbps : kbps.toFixed(1)} kbps`;
}

export function formatMs(value: number | null): string {
  if (value === null) return NA;
  return `${Number.isInteger(value) ? value : value.toFixed(1)} ms`;
}

export function formatPercent(value: number | null, digits = 1): string {
  if (value === null) return NA;
  return `${value.toFixed(digits)} %`;
}

/** 0..1 level as a whole percent, clamped. */
export function formatLevel(level: number | null): string {
  if (level === null) return NA;
  return `${Math.round(Math.min(1, Math.max(0, level)) * 100)} %`;
}

export function formatDuration(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  if (hours > 0) return `${hours} h ${minutes} min ${seconds} s`;
  if (minutes > 0) return `${minutes} min ${seconds} s`;
  return `${seconds} s`;
}

function pad(value: number, width = 2): string {
  return String(value).padStart(width, '0');
}

/** Local wall-clock time with milliseconds, for log lines. */
export function formatClock(epochMs: number): string {
  const d = new Date(epochMs);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}.${pad(d.getMilliseconds(), 3)}`;
}
