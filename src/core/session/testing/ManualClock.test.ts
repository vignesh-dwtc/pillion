import { ManualClock } from './ManualClock';

describe('ManualClock', () => {
  it('fires timers in due order, and in creation order among equal due times', async () => {
    const clock = new ManualClock(100);
    const fired: string[] = [];
    clock.setTimeout(() => fired.push('c@30'), 30);
    clock.setTimeout(() => fired.push('a@10'), 10);
    clock.setTimeout(() => fired.push('b1@20'), 20);
    clock.setTimeout(() => fired.push('b2@20'), 20);
    await clock.advance(25);
    expect(fired).toEqual(['a@10', 'b1@20', 'b2@20']);
    await clock.advance(5);
    expect(fired).toEqual(['a@10', 'b1@20', 'b2@20', 'c@30']);
  });

  it('reports the timer due time as now() while its callback runs, and the target time afterwards', async () => {
    const clock = new ManualClock(1000);
    const seen: number[] = [];
    clock.setTimeout(() => seen.push(clock.now()), 40);
    clock.setTimeout(() => seen.push(clock.now()), 70);
    await clock.advance(100);
    expect(seen).toEqual([1040, 1070]);
    expect(clock.now()).toBe(1100);
  });

  it('fires timers that callbacks schedule inside the same advance window, but not beyond it', async () => {
    const clock = new ManualClock(0);
    const fired: number[] = [];
    clock.setTimeout(() => {
      fired.push(clock.now());
      clock.setTimeout(() => fired.push(clock.now()), 20);
      clock.setTimeout(() => fired.push(clock.now()), 500);
    }, 10);
    await clock.advance(50);
    expect(fired).toEqual([10, 30]);
    expect(clock.pendingTimers()).toBe(1);
    expect(clock.nextDueAt()).toBe(510);
  });

  it('clearTimeout cancels a pending timer; clearing twice or clearing garbage is harmless', async () => {
    const clock = new ManualClock();
    const fn = jest.fn();
    const handle = clock.setTimeout(fn, 10);
    clock.clearTimeout(handle);
    clock.clearTimeout(handle);
    clock.clearTimeout(undefined);
    clock.clearTimeout(42);
    await clock.advance(100);
    expect(fn).not.toHaveBeenCalled();
    expect(clock.pendingTimers()).toBe(0);
  });

  it('lets promise reactions to a timer run before advance() returns', async () => {
    const clock = new ManualClock();
    let steps = 0;
    const chain = new Promise<void>((resolve) => clock.setTimeout(resolve, 10)).then(async () => {
      steps += 1;
      await Promise.resolve();
      await Promise.resolve();
      steps += 1;
    });
    await clock.advance(10);
    expect(steps).toBe(2);
    await chain;
  });

  it('treats negative, NaN and infinite delays as 0', async () => {
    const clock = new ManualClock(5);
    const fired: string[] = [];
    clock.setTimeout(() => fired.push('neg'), -50);
    clock.setTimeout(() => fired.push('nan'), Number.NaN);
    clock.setTimeout(() => fired.push('inf'), Number.POSITIVE_INFINITY);
    await clock.advance(0);
    expect(fired).toEqual(['neg', 'nan', 'inf']);
  });

  it('refuses to hang on a callback that endlessly re-arms a zero-delay timer', async () => {
    const clock = new ManualClock(0, 200);
    const rearm = (): void => {
      clock.setTimeout(rearm, 0);
    };
    clock.setTimeout(rearm, 0);
    await expect(clock.advance(1)).rejects.toThrow(/timer storm/);
  });

  it('counts pending timers, which is how tests prove a ride leaked none', async () => {
    const clock = new ManualClock();
    expect(clock.pendingTimers()).toBe(0);
    expect(clock.nextDueAt()).toBeNull();
    const a = clock.setTimeout(() => undefined, 10);
    clock.setTimeout(() => undefined, 20);
    expect(clock.pendingTimers()).toBe(2);
    clock.clearTimeout(a);
    expect(clock.pendingTimers()).toBe(1);
    await clock.advance(20);
    expect(clock.pendingTimers()).toBe(0);
  });
});
