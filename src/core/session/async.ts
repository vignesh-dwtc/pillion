import type { Clock, TimerHandle } from '../common/types';

/**
 * Small promise utilities for the session layer. Everything time-based goes through the injected `Clock`, so the
 * same code runs on the real clock in the app and on `ManualClock` in the two-peer simulation.
 */

export class Deferred<T> {
  readonly promise: Promise<T>;
  private resolveFn!: (value: T) => void;
  private rejectFn!: (reason: unknown) => void;
  private done = false;

  constructor() {
    this.promise = new Promise<T>((resolve, reject) => {
      this.resolveFn = resolve;
      this.rejectFn = reject;
    });
  }

  get settled(): boolean {
    return this.done;
  }

  resolve(value: T): boolean {
    if (this.done) return false;
    this.done = true;
    this.resolveFn(value);
    return true;
  }

  reject(reason: unknown): boolean {
    if (this.done) return false;
    this.done = true;
    this.rejectFn(reason);
    return true;
  }
}

/** Thrown into async code that is being unwound because its `Scope` was cancelled. Carries the reason. */
export class ScopeCancelled<R = unknown> extends Error {
  readonly reason: R;
  constructor(reason: R) {
    super('cancelled');
    this.name = 'ScopeCancelled';
    this.reason = reason;
  }
}

/**
 * A cancellation scope. `cancel(reason)` is first-wins. Async steps run through `run()` so a cancelled scope
 * unwinds them immediately (even when the underlying native call never settles); a value that arrives after
 * cancellation is handed to `onLate` so the caller can release it (a late channel or media session must not leak).
 */
export class Scope<R> {
  private cancelledWith: { reason: R } | null = null;
  private readonly listeners = new Set<(reason: R) => void>();
  private readonly cancelledDeferred = new Deferred<R>();

  get isCancelled(): boolean {
    return this.cancelledWith !== null;
  }

  get reason(): R | undefined {
    return this.cancelledWith?.reason;
  }

  /** Resolves (never rejects) with the cancellation reason. */
  get whenCancelled(): Promise<R> {
    return this.cancelledDeferred.promise;
  }

  /** Returns true when this call is the one that cancelled the scope. */
  cancel(reason: R): boolean {
    if (this.cancelledWith) return false;
    this.cancelledWith = { reason };
    this.cancelledDeferred.resolve(reason);
    const listeners = [...this.listeners];
    this.listeners.clear();
    for (const listener of listeners) {
      try {
        listener(reason);
      } catch {
        // a cancellation listener must never stop the others
      }
    }
    return true;
  }

  /** Calls `fn` on cancellation (immediately when already cancelled). Returns an unsubscribe. */
  onCancel(fn: (reason: R) => void): () => void {
    if (this.cancelledWith) {
      try {
        fn(this.cancelledWith.reason);
      } catch {
        // see cancel()
      }
      return () => undefined;
    }
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  }

  /**
   * Runs `fn` unless the scope is already cancelled and resolves with its result; rejects with
   * `ScopeCancelled` as soon as the scope is cancelled first. A result that arrives late goes to `onLate`.
   */
  run<T>(fn: () => PromiseLike<T> | T, onLate?: (value: T) => void): Promise<T> {
    if (this.cancelledWith) return Promise.reject(new ScopeCancelled(this.cancelledWith.reason));
    return new Promise<T>((resolve, reject) => {
      let done = false;
      const off = this.onCancel((reason) => {
        if (done) return;
        done = true;
        reject(new ScopeCancelled(reason));
      });
      let started: PromiseLike<T> | T;
      try {
        started = fn();
      } catch (error) {
        if (!done) {
          done = true;
          off();
          reject(error);
        }
        return;
      }
      Promise.resolve(started).then(
        (value) => {
          if (done) {
            if (onLate) {
              try {
                onLate(value);
              } catch {
                // best effort cleanup of a late value
              }
            }
            return;
          }
          done = true;
          off();
          resolve(value);
        },
        (error: unknown) => {
          if (done) return;
          done = true;
          off();
          reject(error);
        },
      );
    });
  }
}

/** Sleeps on the injected clock; rejects with `ScopeCancelled` when the scope is cancelled first. */
export function sleep<R>(clock: Clock, ms: number, scope?: Scope<R>): Promise<void> {
  if (scope?.isCancelled) return Promise.reject(new ScopeCancelled(scope.reason));
  return new Promise<void>((resolve, reject) => {
    const timer: { handle: TimerHandle; off: (() => void) | undefined } = {
      handle: undefined,
      off: undefined,
    };
    timer.handle = clock.setTimeout(() => {
      timer.off?.();
      resolve();
    }, ms);
    timer.off = scope?.onCancel((reason) => {
      clock.clearTimeout(timer.handle);
      reject(new ScopeCancelled(reason));
    });
  });
}

export type Settled<T> =
  { status: 'fulfilled'; value: T } | { status: 'rejected'; error: unknown } | { status: 'timeout' };

/** Waits for `p` for at most `ms` on the injected clock. Never rejects. */
export function settleWithin<T>(clock: Clock, p: PromiseLike<T> | T, ms: number): Promise<Settled<T>> {
  return new Promise<Settled<T>>((resolve) => {
    let finished = false;
    const handle = clock.setTimeout(() => {
      if (finished) return;
      finished = true;
      resolve({ status: 'timeout' });
    }, ms);
    Promise.resolve(p).then(
      (value) => {
        if (finished) return;
        finished = true;
        clock.clearTimeout(handle);
        resolve({ status: 'fulfilled', value });
      },
      (error: unknown) => {
        if (finished) return;
        finished = true;
        clock.clearTimeout(handle);
        resolve({ status: 'rejected', error });
      },
    );
  });
}

/** Like `settleWithin`, but also turns a synchronous throw from `fn` into a `rejected` result. */
export function settleCall<T>(clock: Clock, fn: () => PromiseLike<T> | T, ms: number): Promise<Settled<T>> {
  let started: PromiseLike<T> | T;
  try {
    started = fn();
  } catch (error) {
    return Promise.resolve({ status: 'rejected', error });
  }
  return settleWithin(clock, started, ms);
}

/** Marks a promise as intentionally not awaited and keeps a rejection from becoming unhandled. */
export function detach(p: PromiseLike<unknown> | undefined, onError?: (error: unknown) => void): void {
  if (!p) return;
  Promise.resolve(p).then(undefined, (error: unknown) => {
    if (onError) {
      try {
        onError(error);
      } catch {
        // swallow
      }
    }
  });
}
