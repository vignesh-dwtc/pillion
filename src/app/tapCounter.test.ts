import { DEVELOPER_TAPS_REQUIRED, createTapCounter } from './tapCounter';

function clock(start = 1_000) {
  let t = start;
  return {
    now: () => t,
    advance: (ms: number) => {
      t += ms;
    },
  };
}

describe('createTapCounter', () => {
  it('requires seven taps by default', () => {
    expect(DEVELOPER_TAPS_REQUIRED).toBe(7);
  });

  it('triggers on the seventh tap and not before', () => {
    const c = clock();
    const counter = createTapCounter({ now: c.now });
    for (let i = 1; i <= 6; i += 1) {
      const result = counter.tap();
      expect(result).toEqual({ count: i, remaining: 7 - i, triggered: false });
      c.advance(300);
    }
    expect(counter.tap()).toEqual({ count: 0, remaining: 7, triggered: true });
  });

  it('starts over when taps are further apart than the window', () => {
    const c = clock();
    const counter = createTapCounter({ now: c.now, windowMs: 2000 });
    for (let i = 0; i < 5; i += 1) {
      counter.tap();
      c.advance(500);
    }
    c.advance(3000);
    expect(counter.tap().count).toBe(1);
  });

  it('keeps counting while every gap is inside the window, however long the whole sequence takes', () => {
    const c = clock();
    const counter = createTapCounter({ now: c.now, windowMs: 2000 });
    let last = counter.tap();
    for (let i = 0; i < 5; i += 1) {
      c.advance(1900);
      last = counter.tap();
    }
    expect(last.count).toBe(6);
    c.advance(1900);
    expect(counter.tap().triggered).toBe(true);
  });

  it('can trigger again after a trigger', () => {
    const c = clock();
    const counter = createTapCounter({ now: c.now, required: 3 });
    counter.tap();
    counter.tap();
    expect(counter.tap().triggered).toBe(true);
    counter.tap();
    counter.tap();
    expect(counter.tap().triggered).toBe(true);
  });

  it('reset clears the sequence', () => {
    const c = clock();
    const counter = createTapCounter({ now: c.now });
    counter.tap();
    counter.tap();
    counter.reset();
    expect(counter.tap().count).toBe(1);
  });
});
