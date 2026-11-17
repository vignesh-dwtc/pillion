/** Injectable timer pair with manual time, matching SecureChannelOptions.setTimeout / clearTimeout. */
export class ManualTimers {
  private nextId = 1;
  private clock = 0;
  private readonly timers = new Map<number, { at: number; fn: () => void }>();
  readonly cleared: number[] = [];

  readonly setTimeout = (fn: () => void, ms: number): unknown => {
    const id = this.nextId++;
    this.timers.set(id, { at: this.clock + ms, fn });
    return id;
  };

  readonly clearTimeout = (handle: unknown): void => {
    if (typeof handle === 'number') {
      this.cleared.push(handle);
      this.timers.delete(handle);
    }
  };

  get pending(): number {
    return this.timers.size;
  }

  get now(): number {
    return this.clock;
  }

  /** Moves time forward and fires every timer that comes due, in order. */
  advance(ms: number): void {
    const target = this.clock + ms;
    for (;;) {
      let nextId: number | null = null;
      let nextAt = Infinity;
      for (const [id, timer] of this.timers) {
        if (timer.at <= target && timer.at < nextAt) {
          nextAt = timer.at;
          nextId = id;
        }
      }
      if (nextId === null) break;
      const timer = this.timers.get(nextId);
      this.timers.delete(nextId);
      this.clock = Math.max(this.clock, nextAt);
      timer?.fn();
    }
    this.clock = target;
  }
}
