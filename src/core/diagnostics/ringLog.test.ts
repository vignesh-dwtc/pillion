import { ManualClock } from '../session/testing';
import { createRingLog } from './ringLog';
import { REDACTED } from './redact';
import type { RingLogPersistence } from './types';

const SECRET_B64 = 'Zm9vYmFyYmF6cXV4MTIzNDU2Nzg5MGFiY2RlZmdoaWo';

function memoryStore(initial?: string): RingLogPersistence & { saves: string[]; value: string | undefined } {
  const store = {
    saves: [] as string[],
    value: initial,
    load: () => store.value,
    save: (s: string) => {
      store.saves.push(s);
      store.value = s;
    },
  };
  return store;
}

describe('createRingLog', () => {
  it('keeps at most `capacity` entries, newest last', () => {
    const log = createRingLog({ capacity: 3, now: () => 1 });
    for (let i = 0; i < 10; i++) log.log('info', 'tag', `m${i}`);
    expect(log.entries().map((e) => e.message)).toEqual(['m7', 'm8', 'm9']);
  });

  it('defaults to 500 entries', () => {
    const log = createRingLog({ now: () => 0 });
    for (let i = 0; i < 600; i++) log.log('debug', 't', `m${i}`);
    expect(log.entries()).toHaveLength(500);
    expect(log.entries()[0]?.message).toBe('m100');
  });

  it('uses the injected time source', () => {
    let t = 1000;
    const log = createRingLog({ now: () => t });
    log.log('warn', 'a', 'one');
    t = 2000;
    log.log('error', 'a', 'two', { code: 7 });
    expect(log.entries().map((e) => [e.t, e.level, e.data])).toEqual([
      [1000, 'warn', undefined],
      [2000, 'error', { code: 7 }],
    ]);
  });

  it('redacts keys and secret-looking values and never stores them', () => {
    const log = createRingLog({ now: () => 0, sensitiveValues: () => ['the-wifi-pass'] });
    log.log('info', 'pairing', `scanned ${SECRET_B64}`, {
      secret: SECRET_B64,
      hint: SECRET_B64,
      w: 'the-wifi-pass',
      ok: 1,
    });
    const dump = JSON.stringify(log.entries());
    expect(dump).not.toContain(SECRET_B64);
    expect(dump).not.toContain('the-wifi-pass');
    expect(log.entries()[0]?.data?.secret).toBe(REDACTED);
    expect(log.entries()[0]?.data?.ok).toBe(1);
  });

  it('keeps entries single-line and bounded', () => {
    const log = createRingLog({ now: () => 0 });
    log.log('info', 't', `line1\nline2\u0000${'x'.repeat(2000)}`);
    const message = log.entries()[0]?.message ?? '';
    expect(message).not.toMatch(/[\n\u0000]/);
    expect(message.length).toBeLessThan(500);
  });

  it('entries() returns a copy and entries are frozen', () => {
    const log = createRingLog({ now: () => 0 });
    log.log('info', 't', 'm');
    const list = log.entries();
    list.pop();
    expect(log.entries()).toHaveLength(1);
    expect(Object.isFrozen(log.entries()[0])).toBe(true);
  });

  it('clear() empties the log and persists the empty state', () => {
    const store = memoryStore();
    const log = createRingLog({ now: () => 0, persistence: store });
    log.log('info', 't', 'm');
    log.clear();
    expect(log.entries()).toEqual([]);
    expect(JSON.parse(store.saves[store.saves.length - 1] ?? '{}').entries).toEqual([]);
  });

  it('never throws, whatever it is given', () => {
    const throwing: RingLogPersistence = {
      load: () => {
        throw new Error('disk');
      },
      save: () => {
        throw new Error('disk full');
      },
    };
    const log = createRingLog({ now: () => 0, persistence: throwing });
    expect(() => log.log('error', 't', 'm', { a: { b: 1 } as never })).not.toThrow();
    expect(() => log.log('nonsense' as never, undefined as never, undefined as never)).not.toThrow();
    expect(() => log.clear()).not.toThrow();
  });

  describe('persistence', () => {
    it('restores on construction, trims to capacity and re-redacts old entries', () => {
      const old = JSON.stringify({
        v: 1,
        entries: [
          { t: 1, level: 'info', tag: 'a', message: 'one' },
          { t: 2, level: 'info', tag: 'a', message: `leak ${SECRET_B64}`, data: { secret: 'x', n: 1 } },
          { t: 3, level: 'bogus', tag: 'a', message: 'bad level' },
          'garbage',
          { t: 4, level: 'warn', tag: 'a', message: 'four' },
        ],
      });
      const log = createRingLog({ capacity: 2, persistence: memoryStore(old), now: () => 9 });
      const entries = log.entries();
      expect(entries.map((e) => e.t)).toEqual([2, 4]);
      expect(JSON.stringify(entries)).not.toContain(SECRET_B64);
      expect(entries[0]?.data).toEqual({ secret: REDACTED, n: 1 });
    });

    it('starts empty on corrupt storage', () => {
      expect(createRingLog({ persistence: memoryStore('{not json'), now: () => 0 }).entries()).toEqual([]);
      expect(createRingLog({ persistence: memoryStore('{"entries":5}'), now: () => 0 }).entries()).toEqual(
        [],
      );
    });

    it('round-trips through a second instance', () => {
      const store = memoryStore();
      const first = createRingLog({ persistence: store, now: () => 5, persistIntervalMs: 0 });
      first.log('info', 'tag', 'hello', { n: 2 });
      const second = createRingLog({ persistence: store, now: () => 6 });
      expect(second.entries()).toEqual(first.entries());
    });

    it('rate-limits writes: leading edge at once, bursts coalesced into one trailing write', async () => {
      const clock = new ManualClock(10_000);
      const store = memoryStore();
      const log = createRingLog({ persistence: store, clock, persistIntervalMs: 2000 });
      log.log('info', 't', 'first');
      expect(store.saves).toHaveLength(1);
      for (let i = 0; i < 50; i++) log.log('info', 't', `burst${i}`);
      expect(store.saves).toHaveLength(1);
      await clock.advance(1999);
      expect(store.saves).toHaveLength(1);
      await clock.advance(1);
      expect(store.saves).toHaveLength(2);
      expect(JSON.parse(store.saves[1] ?? '{}').entries).toHaveLength(51);
      await clock.advance(10_000);
      expect(store.saves).toHaveLength(2);
      log.log('info', 't', 'later');
      expect(store.saves).toHaveLength(3);
    });

    it('writes errors at once and flush() writes what is pending', async () => {
      const clock = new ManualClock(0);
      const store = memoryStore();
      const log = createRingLog({ persistence: store, clock, persistIntervalMs: 60_000 });
      log.log('info', 't', 'a');
      log.log('info', 't', 'b');
      expect(store.saves).toHaveLength(1);
      log.log('error', 't', 'crash');
      expect(store.saves).toHaveLength(2);
      log.log('info', 't', 'c');
      log.flush();
      expect(store.saves).toHaveLength(3);
      log.flush();
      expect(store.saves).toHaveLength(3);
    });
  });

  describe('subscribe', () => {
    it('notifies after appends, rate-limited, and stops after unsubscribe; a throwing listener is harmless', async () => {
      const clock = new ManualClock(0);
      const log = createRingLog({ clock, notifyIntervalMs: 250 });
      let calls = 0;
      log.subscribe(() => {
        throw new Error('bad listener');
      });
      const off = log.subscribe(() => {
        calls += 1;
      });
      log.log('info', 't', 'a');
      expect(calls).toBe(1);
      log.log('info', 't', 'b');
      log.log('info', 't', 'c');
      expect(calls).toBe(1);
      await clock.advance(250);
      expect(calls).toBe(2);
      off();
      log.log('info', 't', 'd');
      await clock.advance(1000);
      expect(calls).toBe(2);
    });
  });
});
