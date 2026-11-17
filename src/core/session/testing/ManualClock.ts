import type { Clock, TimerHandle } from '../../common/types';

/**
 * Deterministic clock for tests and the two-peer simulation. Time only moves when `advance()` is called; timers
 * fire in (due time, creation order) order and `now()` equals the timer's due time while its callback runs.
 *
 * The state machine is promise-based, so after every fired timer `advance()` lets the microtask queue drain
 * (`settle()`): by the time it returns, every reaction to the timer has run. There are no real timers and no
 * randomness anywhere, so a scenario that passes once passes always.
 */

/** How many promise turns one settle() waits. Far deeper than any chain in the session layer. */
const SETTLE_TURNS = 300;

/** A guard against a callback that keeps re-arming a zero-delay timer: advance() would never return. */
const DEFAULT_MAX_FIRES_PER_ADVANCE = 50_000;

interface ManualTimer {
  readonly id: number;
  due: number;
  fn: () => void;
}

export class ManualClock implements Clock {
  private current: number;
  private nextId = 1;
  private readonly timers = new Map<number, ManualTimer>();

  constructor(
    startMs = 0,
    private readonly maxFiresPerAdvance = DEFAULT_MAX_FIRES_PER_ADVANCE,
  ) {
    this.current = startMs;
  }

  now(): number {
    return this.current;
  }

  setTimeout(fn: () => void, ms: number): TimerHandle {
    const delay = Number.isFinite(ms) ? Math.max(0, ms) : 0;
    const timer: ManualTimer = { id: this.nextId, due: this.current + delay, fn };
    this.nextId += 1;
    this.timers.set(timer.id, timer);
    return timer;
  }

  clearTimeout(handle: TimerHandle): void {
    if (typeof handle === 'object' && handle !== null && 'id' in handle) {
      this.timers.delete((handle as ManualTimer).id);
    }
  }

  /** Number of timers that have not fired and not been cleared. A leak check: 0 after a ride has ended. */
  pendingTimers(): number {
    return this.timers.size;
  }

  /** Due time of the earliest pending timer, or null. */
  nextDueAt(): number | null {
    let earliest: number | null = null;
    for (const timer of this.timers.values()) {
      if (earliest === null || timer.due < earliest) earliest = timer.due;
    }
    return earliest;
  }

  /** Lets every already-queued promise reaction run (including the ones they queue in turn). */
  async settle(turns = SETTLE_TURNS): Promise<void> {
    for (let i = 0; i < turns; i += 1) await Promise.resolve();
  }

  /** Moves time forward by `ms`, firing due timers in order and settling promises after each one. */
  async advance(ms: number): Promise<void> {
    const target = this.current + Math.max(0, ms);
    await this.settle();
    let fires = 0;
    for (;;) {
      const next = this.earliest();
      if (next === null || next.due > target) break;
      fires += 1;
      if (fires > this.maxFiresPerAdvance) {
        throw new Error(
          `ManualClock: more than ${this.maxFiresPerAdvance} timers fired in one advance(); a timer storm`,
        );
      }
      this.timers.delete(next.id);
      this.current = Math.max(this.current, next.due);
      next.fn();
      await this.settle();
    }
    this.current = target;
    await this.settle();
  }

  private earliest(): ManualTimer | null {
    let best: ManualTimer | null = null;
    for (const timer of this.timers.values()) {
      // Map iteration is creation order, so a strict `<` keeps the first-created among equal due times.
      if (best === null || timer.due < best.due) best = timer;
    }
    return best;
  }
}
