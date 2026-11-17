import type { Clock, LogData, LogLevel, Logger } from '../../common/types';

export interface MemoryLogEntry {
  t: number;
  level: LogLevel;
  tag: string;
  message: string;
  data?: LogData;
}

/** Collects log lines in memory with the injected clock's timestamps: assertions and failure dumps. */
export class MemoryLogger implements Logger {
  readonly entries: MemoryLogEntry[] = [];

  constructor(private readonly clock: Clock) {}

  log(level: LogLevel, tag: string, message: string, data?: LogData): void {
    this.entries.push({ t: this.clock.now(), level, tag, message, data });
  }

  /** Every entry as one line of text, for `toContain` / `not.toContain` checks. */
  text(): string {
    return this.entries.map((entry) => this.format(entry)).join('\n');
  }

  tail(count: number): string {
    return this.entries
      .slice(-count)
      .map((entry) => this.format(entry))
      .join('\n');
  }

  messages(): string[] {
    return this.entries.map((entry) => entry.message);
  }

  private format(entry: MemoryLogEntry): string {
    const data = entry.data ? ` ${JSON.stringify(entry.data)}` : '';
    return `${entry.t} ${entry.level} ${entry.tag} ${entry.message}${data}`;
  }
}
