import { Deferred, Scope, ScopeCancelled, detach, settleCall, settleWithin, sleep } from './async';
import { ManualClock } from './testing/ManualClock';

describe('Deferred', () => {
  it('settles once; later settles are ignored', async () => {
    const d = new Deferred<number>();
    expect(d.settled).toBe(false);
    expect(d.resolve(1)).toBe(true);
    expect(d.resolve(2)).toBe(false);
    expect(d.reject(new Error('late'))).toBe(false);
    expect(d.settled).toBe(true);
    await expect(d.promise).resolves.toBe(1);
  });
});

describe('Scope', () => {
  it('cancel is first-wins and exposes the reason', async () => {
    const scope = new Scope<string>();
    expect(scope.isCancelled).toBe(false);
    expect(scope.cancel('first')).toBe(true);
    expect(scope.cancel('second')).toBe(false);
    expect(scope.isCancelled).toBe(true);
    expect(scope.reason).toBe('first');
    await expect(scope.whenCancelled).resolves.toBe('first');
  });

  it('run() resolves with the value of a step that finishes first', async () => {
    const scope = new Scope<string>();
    await expect(scope.run(() => Promise.resolve(7))).resolves.toBe(7);
    await expect(scope.run(() => 8)).resolves.toBe(8);
  });

  it('run() passes a rejection through and a synchronous throw too', async () => {
    const scope = new Scope<string>();
    await expect(scope.run(() => Promise.reject(new Error('boom')))).rejects.toThrow('boom');
    await expect(
      scope.run(() => {
        throw new Error('sync boom');
      }),
    ).rejects.toThrow('sync boom');
  });

  it('run() unwinds with ScopeCancelled the moment the scope is cancelled, even if the step never settles', async () => {
    const scope = new Scope<string>();
    const pending = scope.run(() => new Promise<number>(() => undefined));
    scope.cancel('stop');
    const error = await pending.catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ScopeCancelled);
    expect((error as ScopeCancelled<string>).reason).toBe('stop');
  });

  it('run() on an already cancelled scope does not even start the step', async () => {
    const scope = new Scope<string>();
    scope.cancel('done');
    const fn = jest.fn(() => Promise.resolve(1));
    await expect(scope.run(fn)).rejects.toBeInstanceOf(ScopeCancelled);
    expect(fn).not.toHaveBeenCalled();
  });

  it('hands a value that arrives after cancellation to onLate, so it can be released', async () => {
    const scope = new Scope<string>();
    let resolveStep!: (value: string) => void;
    const late = jest.fn();
    const pending = scope.run(() => new Promise<string>((resolve) => (resolveStep = resolve)), late);
    scope.cancel('x');
    await pending.catch(() => undefined);
    resolveStep('channel');
    await Promise.resolve();
    await Promise.resolve();
    expect(late).toHaveBeenCalledWith('channel');
  });

  it('does not call onLate for a rejection, and survives an onLate that throws', async () => {
    const scope = new Scope<string>();
    let rejectStep!: (e: Error) => void;
    const late = jest.fn(() => {
      throw new Error('cleanup failed');
    });
    const pending = scope.run(() => new Promise<string>((_resolve, reject) => (rejectStep = reject)), late);
    scope.cancel('x');
    await pending.catch(() => undefined);
    rejectStep(new Error('step failed'));
    await Promise.resolve();
    await Promise.resolve();
    expect(late).not.toHaveBeenCalled();
  });

  it('onCancel fires on cancel, immediately when already cancelled, and can be unsubscribed; a throwing listener is contained', () => {
    const scope = new Scope<number>();
    const seen: number[] = [];
    const off = scope.onCancel((r) => seen.push(r));
    scope.onCancel(() => {
      throw new Error('listener bug');
    });
    scope.onCancel((r) => seen.push(r * 10));
    off();
    scope.cancel(2);
    expect(seen).toEqual([20]);
    scope.onCancel((r) => seen.push(r + 100));
    expect(seen).toEqual([20, 102]);
  });
});

describe('sleep', () => {
  it('resolves after the delay on the injected clock and leaves no timer behind', async () => {
    const clock = new ManualClock();
    let done = false;
    void sleep(clock, 500).then(() => (done = true));
    await clock.advance(499);
    expect(done).toBe(false);
    await clock.advance(1);
    expect(done).toBe(true);
    expect(clock.pendingTimers()).toBe(0);
  });

  it('is cut short by its scope, clearing its timer', async () => {
    const clock = new ManualClock();
    const scope = new Scope<string>();
    const pending = sleep(clock, 10_000, scope);
    scope.cancel('stop');
    await expect(pending).rejects.toBeInstanceOf(ScopeCancelled);
    expect(clock.pendingTimers()).toBe(0);
  });

  it('rejects at once on an already cancelled scope without arming a timer', async () => {
    const clock = new ManualClock();
    const scope = new Scope<string>();
    scope.cancel('stop');
    await expect(sleep(clock, 100, scope)).rejects.toBeInstanceOf(ScopeCancelled);
    expect(clock.pendingTimers()).toBe(0);
  });
});

describe('settleWithin / settleCall', () => {
  it('reports fulfilled, rejected and timeout, never throwing', async () => {
    const clock = new ManualClock();
    await expect(settleWithin(clock, Promise.resolve(1), 100)).resolves.toEqual({
      status: 'fulfilled',
      value: 1,
    });
    const failure = new Error('x');
    await expect(settleWithin(clock, Promise.reject(failure), 100)).resolves.toEqual({
      status: 'rejected',
      error: failure,
    });
    const slow = settleWithin(clock, new Promise<number>(() => undefined), 100);
    await clock.advance(100);
    await expect(slow).resolves.toEqual({ status: 'timeout' });
    expect(clock.pendingTimers()).toBe(0);
  });

  it('settleCall turns a synchronous throw into rejected', async () => {
    const clock = new ManualClock();
    const error = new Error('sync');
    const result = await settleCall(
      clock,
      () => {
        throw error;
      },
      100,
    );
    expect(result).toEqual({ status: 'rejected', error });
    await expect(settleCall(clock, () => 5, 100)).resolves.toEqual({ status: 'fulfilled', value: 5 });
  });
});

describe('detach', () => {
  it('swallows a rejection, reports it to the callback, and tolerates undefined', async () => {
    const seen: unknown[] = [];
    detach(Promise.reject(new Error('quiet')), (e) => seen.push((e as Error).message));
    detach(undefined);
    detach(Promise.reject(new Error('no callback')));
    detach(Promise.reject(new Error('throwing callback')), () => {
      throw new Error('callback bug');
    });
    await Promise.resolve();
    await Promise.resolve();
    expect(seen).toEqual(['quiet']);
  });
});
