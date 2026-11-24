import { createNativeRideClock, hasRideTimers, type RideTimerNativeModule } from './NativeRideClock';

type TimerListener = (event: { id: number }) => void;

class FakeTimerNative implements RideTimerNativeModule {
  readonly scheduled = new Map<number, number>();
  readonly cancelled: number[] = [];
  readonly listeners = new Set<TimerListener>();
  refuse = false;
  throwOnSchedule = false;

  scheduleTimer(id: number, delayMs: number): boolean {
    if (this.throwOnSchedule) throw new Error('native gone');
    if (this.refuse) return false;
    this.scheduled.set(id, delayMs);
    return true;
  }
  cancelTimer(id: number): void {
    this.cancelled.push(id);
    this.scheduled.delete(id);
  }
  addListener(_eventName: 'onTimer', listener: TimerListener) {
    this.listeners.add(listener);
    return { remove: () => this.listeners.delete(listener) };
  }
  /** The native Handler fired [id] (whether or not JS still wants it). */
  fire(id: number) {
    this.scheduled.delete(id);
    for (const l of [...this.listeners]) l({ id });
  }
}

describe('NativeRideClock', () => {
  it('schedules natively and runs the callback when onTimer arrives, once', () => {
    const native = new FakeTimerNative();
    const clock = createNativeRideClock(native, () => 42);
    const calls: string[] = [];
    clock.setTimeout(() => calls.push('ping'), 2000);
    clock.setTimeout(() => calls.push('watchdog'), 6000);
    expect([...native.scheduled.values()]).toEqual([2000, 6000]);
    const [pingId, watchdogId] = [...native.scheduled.keys()] as [number, number];
    native.fire(pingId);
    native.fire(pingId); // a duplicate event is ignored
    expect(calls).toEqual(['ping']);
    native.fire(watchdogId);
    expect(calls).toEqual(['ping', 'watchdog']);
    expect(clock.now()).toBe(42);
  });

  it('a cleared timer never runs, even when its native event was already in flight', () => {
    const native = new FakeTimerNative();
    const clock = createNativeRideClock(native);
    const fn = jest.fn();
    const handle = clock.setTimeout(fn, 100);
    const [id] = [...native.scheduled.keys()] as [number];
    clock.clearTimeout(handle);
    expect(native.cancelled).toEqual([id]);
    native.fire(id);
    expect(fn).not.toHaveBeenCalled();
    clock.clearTimeout(handle); // idempotent: no second native call
    clock.clearTimeout(undefined);
    clock.clearTimeout(null);
    clock.clearTimeout(123);
    expect(native.cancelled).toEqual([id]);
  });

  it('clearing a timer that already fired does not cancel anything natively', () => {
    const native = new FakeTimerNative();
    const clock = createNativeRideClock(native);
    const handle = clock.setTimeout(() => undefined, 10);
    native.fire([...native.scheduled.keys()][0]!);
    clock.clearTimeout(handle);
    expect(native.cancelled).toEqual([]);
  });

  it('negative or non-finite delays are sent as 0; ids are unique', () => {
    const native = new FakeTimerNative();
    const clock = createNativeRideClock(native);
    clock.setTimeout(() => undefined, -5);
    clock.setTimeout(() => undefined, Number.NaN);
    expect([...native.scheduled.values()]).toEqual([0, 0]);
    expect(new Set(native.scheduled.keys()).size).toBe(2);
  });

  it('falls back to JS timers when the native queue refuses or throws', () => {
    jest.useFakeTimers();
    try {
      const native = new FakeTimerNative();
      const clock = createNativeRideClock(native);
      native.refuse = true;
      const refused = jest.fn();
      clock.setTimeout(refused, 50);
      native.refuse = false;
      native.throwOnSchedule = true;
      const thrown = jest.fn();
      const cleared = jest.fn();
      clock.setTimeout(thrown, 50);
      clock.clearTimeout(clock.setTimeout(cleared, 50));
      jest.advanceTimersByTime(50);
      expect(refused).toHaveBeenCalledTimes(1);
      expect(thrown).toHaveBeenCalledTimes(1);
      expect(cleared).not.toHaveBeenCalled();
      expect(native.cancelled).toEqual([]);
    } finally {
      jest.useRealTimers();
    }
  });

  it('a heartbeat chain re-armed from its own callback keeps ticking', () => {
    const native = new FakeTimerNative();
    const clock = createNativeRideClock(native);
    let ticks = 0;
    const beat = () => {
      ticks += 1;
      clock.setTimeout(beat, 2000);
    };
    clock.setTimeout(beat, 2000);
    for (let i = 0; i < 300; i += 1) native.fire([...native.scheduled.keys()][0]!);
    expect(ticks).toBe(300);
    expect(native.scheduled.size).toBe(1);
  });

  it('detects whether a native module has the timer functions', () => {
    expect(hasRideTimers(null)).toBe(false);
    expect(hasRideTimers({ start: () => undefined })).toBe(false);
    expect(hasRideTimers(new FakeTimerNative())).toBe(true);
  });
});
