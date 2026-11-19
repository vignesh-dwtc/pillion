import { createHoldController, type HoldDriver } from './holdController';

/** A driver whose runs finish only when the test says so (like a stoppable Animated.timing). */
function fakeDriver() {
  const runs: { to: 0 | 1; ms: number; done: (finished: boolean) => void; stopped: boolean }[] = [];
  let progress = 0;
  const driver: HoldDriver = {
    run(to, ms, done) {
      const run = { to, ms, done, stopped: false };
      runs.push(run);
      return () => {
        if (run.stopped) return;
        run.stopped = true;
        done(false);
      };
    },
    reset() {
      progress = 0;
    },
  };
  const finish = (index = runs.length - 1) => {
    const run = runs[index]!;
    if (run.stopped) return;
    run.stopped = true;
    progress = run.to;
    run.done(true);
  };
  return { driver, runs, finish, progress: () => progress };
}

function setup() {
  jest.useFakeTimers();
  const d = fakeDriver();
  const onComplete = jest.fn();
  const armedChanges: boolean[] = [];
  const controller = createHoldController({
    driver: d.driver,
    onComplete,
    onArmedChange: (armed) => armedChanges.push(armed),
    holdMs: 1000,
    releaseMs: 200,
    confirmWindowMs: 5000,
  });
  return { ...d, onComplete, armedChanges, controller };
}

afterEach(() => {
  jest.useRealTimers();
});

describe('hold to end', () => {
  it('completes once after the full hold and resets the progress', () => {
    const t = setup();
    t.controller.pressIn();
    expect(t.runs[0]).toMatchObject({ to: 1, ms: 1000 });
    t.finish();
    expect(t.onComplete).toHaveBeenCalledTimes(1);
    expect(t.progress()).toBe(0);
    // Releasing after completion does not start a reverse run, and nothing fires twice.
    t.controller.pressOut();
    expect(t.runs).toHaveLength(1);
    expect(t.onComplete).toHaveBeenCalledTimes(1);
  });

  it('reverses on early release and never completes', () => {
    const t = setup();
    t.controller.pressIn();
    t.controller.pressOut();
    expect(t.runs[0]!.stopped).toBe(true);
    expect(t.runs[1]).toMatchObject({ to: 0, ms: 200 });
    t.finish();
    // The stopped forward run reporting late must not complete either.
    t.runs[0]!.done(true);
    expect(t.onComplete).not.toHaveBeenCalled();
  });

  it('can hold again after a completed hold', () => {
    const t = setup();
    t.controller.pressIn();
    t.finish();
    t.controller.pressIn();
    t.finish();
    expect(t.onComplete).toHaveBeenCalledTimes(2);
  });

  it('stops an in-flight hold on dispose, so it cannot complete after unmount', () => {
    const t = setup();
    t.controller.pressIn();
    t.controller.dispose();
    expect(t.runs[0]!.stopped).toBe(true);
    t.runs[0]!.done(true);
    t.controller.pressIn();
    t.controller.accessibilityActivate();
    t.controller.accessibilityActivate();
    expect(t.onComplete).not.toHaveBeenCalled();
    expect(t.progress()).toBe(0);
  });
});

describe('screen-reader confirm', () => {
  it('arms on the first activate and completes on the second, without a hold', () => {
    const t = setup();
    t.controller.accessibilityActivate();
    expect(t.onComplete).not.toHaveBeenCalled();
    expect(t.armedChanges).toEqual([true]);
    t.controller.accessibilityActivate();
    expect(t.onComplete).toHaveBeenCalledTimes(1);
    expect(t.armedChanges).toEqual([true, false]);
    expect(t.runs).toHaveLength(0);
  });

  it('disarms after the confirm window, so a later activate only arms again', () => {
    const t = setup();
    t.controller.accessibilityActivate();
    jest.advanceTimersByTime(5000);
    expect(t.armedChanges).toEqual([true, false]);
    t.controller.accessibilityActivate();
    expect(t.onComplete).not.toHaveBeenCalled();
    expect(t.armedChanges).toEqual([true, false, true]);
  });

  it('clears the confirm timer on dispose', () => {
    const t = setup();
    t.controller.accessibilityActivate();
    t.controller.dispose();
    expect(jest.getTimerCount()).toBe(0);
  });
});
