/**
 * Hold-to-act logic for the End ride plate, kept free of React and Animated so it is unit tested
 * (holdController.test.ts). The component supplies a `driver` that animates the progress stroke.
 *
 * - pressIn starts a `holdMs` run to 1; finishing it completes. pressOut before that reverses to 0 in `releaseMs`.
 * - Completion fires once, resets the progress to 0 and needs a new press-in to fire again.
 * - Screen readers: the first `activate` arms (announce "activate again"); a second one within `confirmWindowMs`
 *   completes without the hold. The arm expires after the window.
 * - dispose (unmount): stops any run, clears timers and resets progress, so nothing fires after the screen is gone
 *   (for example when the partner ends the ride mid-hold).
 */

export interface HoldDriver {
  /** Animate progress to `to` over `ms`; call `done(finished)` once. Returns a function that stops the run. */
  run(to: 0 | 1, ms: number, done: (finished: boolean) => void): () => void;
  /** Jump to 0 without animating. */
  reset(): void;
}

export interface HoldTimers {
  set(fn: () => void, ms: number): unknown;
  clear(handle: unknown): void;
}

export interface HoldControllerOptions {
  driver: HoldDriver;
  onComplete: () => void;
  onArmedChange?: (armed: boolean) => void;
  /** Haptic tick when a hold starts. */
  onHoldStart?: () => void;
  /** Haptic when the hold (or the confirmed action) completes. */
  onCompleteFeedback?: () => void;
  /** Screen-reader announcement when armed. */
  announceArmed?: () => void;
  holdMs: number;
  releaseMs: number;
  confirmWindowMs: number;
  timers?: HoldTimers;
}

export interface HoldController {
  pressIn(): void;
  pressOut(): void;
  accessibilityActivate(): void;
  dispose(): void;
}

const defaultTimers: HoldTimers = {
  set: (fn, ms) => setTimeout(fn, ms),
  clear: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
};

export function createHoldController(options: HoldControllerOptions): HoldController {
  const timers = options.timers ?? defaultTimers;
  let stopRun: (() => void) | null = null;
  let runId = 0;
  let done = false;
  let disposed = false;
  let armed = false;
  let armTimer: unknown = null;

  const stop = () => {
    runId += 1;
    const s = stopRun;
    stopRun = null;
    s?.();
  };

  const setArmed = (value: boolean) => {
    if (armTimer !== null) {
      timers.clear(armTimer);
      armTimer = null;
    }
    if (value) armTimer = timers.set(() => setArmed(false), options.confirmWindowMs);
    if (armed === value) return;
    armed = value;
    options.onArmedChange?.(value);
  };

  const complete = () => {
    if (done || disposed) return;
    done = true;
    stop();
    options.driver.reset();
    options.onCompleteFeedback?.();
    options.onComplete();
  };

  const start = (to: 0 | 1, ms: number, onFinished?: () => void) => {
    stop();
    const id = runId;
    stopRun = options.driver.run(to, ms, (finished) => {
      if (id !== runId) return;
      stopRun = null;
      if (finished) onFinished?.();
    });
  };

  return {
    pressIn() {
      if (disposed) return;
      done = false;
      setArmed(false);
      options.onHoldStart?.();
      start(1, options.holdMs, complete);
    },
    pressOut() {
      if (disposed || done) return;
      start(0, options.releaseMs);
    },
    accessibilityActivate() {
      if (disposed) return;
      if (!armed) {
        setArmed(true);
        options.announceArmed?.();
        return;
      }
      setArmed(false);
      done = false;
      complete();
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      stop();
      if (armTimer !== null) timers.clear(armTimer);
      armTimer = null;
      options.driver.reset();
    },
  };
}
