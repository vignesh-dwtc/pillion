import { AUDIO_TUNABLE_LIMITS, DEFAULT_AUDIO_TUNABLES, type AudioTunables } from './AudioTunables';
import {
  captureConstraintsDiffer,
  clampTunables,
  describeTunables,
  toGetUserMediaConstraints,
} from './tunables';

describe('clampTunables', () => {
  it('returns the defaults for nothing and for garbage, never throwing', () => {
    const garbage: unknown[] = [undefined, null, 0, 'x', true, [], [1, 2], () => 1, Symbol('s'), NaN];
    expect(clampTunables()).toEqual(DEFAULT_AUDIO_TUNABLES);
    for (const g of garbage) expect(clampTunables(g)).toEqual(DEFAULT_AUDIO_TUNABLES);
  });

  it('does not return the shared defaults object itself', () => {
    expect(clampTunables()).not.toBe(DEFAULT_AUDIO_TUNABLES);
  });

  it('keeps valid values and fills the rest from the defaults', () => {
    expect(clampTunables({ opusDtx: true, opusBitrateBps: 32_000 })).toEqual({
      ...DEFAULT_AUDIO_TUNABLES,
      opusDtx: true,
      opusBitrateBps: 32_000,
    });
  });

  it('clamps the bitrate to the limits and rounds it', () => {
    const { min, max } = AUDIO_TUNABLE_LIMITS.opusBitrateBps;
    expect(clampTunables({ opusBitrateBps: 1 }).opusBitrateBps).toBe(min);
    expect(clampTunables({ opusBitrateBps: -5 }).opusBitrateBps).toBe(min);
    expect(clampTunables({ opusBitrateBps: 10_000_000 }).opusBitrateBps).toBe(max);
    expect(clampTunables({ opusBitrateBps: 23_999.6 }).opusBitrateBps).toBe(24_000);
  });

  it('rejects NaN, infinities and non-numbers for numeric fields (default wins)', () => {
    for (const bad of [NaN, Infinity, -Infinity, '48000', null, {}, [], true]) {
      const t = clampTunables({ opusBitrateBps: bad, opusPacketTimeMs: bad });
      expect(t.opusBitrateBps).toBe(DEFAULT_AUDIO_TUNABLES.opusBitrateBps);
      expect(t.opusPacketTimeMs).toBe(DEFAULT_AUDIO_TUNABLES.opusPacketTimeMs);
    }
  });

  it('snaps packet time to the nearest allowed value, ties to the shorter one', () => {
    const cases: [number, number][] = [
      [10, 10],
      [14, 10],
      [15, 10],
      [16, 20],
      [20, 20],
      [30, 20],
      [31, 40],
      [40, 40],
      [50, 40],
      [51, 60],
      [60, 60],
      [120, 60],
      [0, 10],
      [-3, 10],
    ];
    for (const [input, expected] of cases) {
      expect(clampTunables({ opusPacketTimeMs: input }).opusPacketTimeMs).toBe(expected);
    }
  });

  it('only accepts real booleans', () => {
    const t = clampTunables({ noiseSuppression: 'false', autoGainControl: 0, opusFec: null, opusDtx: 1 });
    expect(t).toEqual(DEFAULT_AUDIO_TUNABLES);
    expect(clampTunables({ noiseSuppression: false, echoCancellation: false })).toEqual({
      ...DEFAULT_AUDIO_TUNABLES,
      noiseSuppression: false,
      echoCancellation: false,
    });
  });

  it('drops unknown keys', () => {
    const t = clampTunables({ evil: 1, __proto__: { opusDtx: true } } as unknown);
    expect(Object.keys(t).sort()).toEqual(Object.keys(DEFAULT_AUDIO_TUNABLES).sort());
    expect(t.opusDtx).toBe(false);
  });

  it('survives a throwing getter', () => {
    const hostile = {
      get opusFec(): boolean {
        throw new Error('boom');
      },
      opusDtx: true,
    };
    expect(clampTunables(hostile)).toEqual({ ...DEFAULT_AUDIO_TUNABLES, opusDtx: true });
  });

  it('uses a supplied base for missing fields and sanitises the base too', () => {
    const base: AudioTunables = {
      ...DEFAULT_AUDIO_TUNABLES,
      noiseSuppression: false,
      opusBitrateBps: 40_000,
    };
    expect(clampTunables({ opusFec: false }, base)).toEqual({ ...base, opusFec: false });
    const badBase = { ...DEFAULT_AUDIO_TUNABLES, opusBitrateBps: NaN, opusPacketTimeMs: 33 as 20 };
    const t = clampTunables({}, badBase);
    expect(t.opusBitrateBps).toBe(24_000);
    expect(t.opusPacketTimeMs).toBe(40);
  });

  it('is idempotent', () => {
    const once = clampTunables({ opusBitrateBps: 99_999, opusPacketTimeMs: 33, opusDtx: true });
    expect(clampTunables(once)).toEqual(once);
  });
});

describe('toGetUserMediaConstraints', () => {
  it('native: exactly the four names the LiveKit fork reads', () => {
    expect(toGetUserMediaConstraints(DEFAULT_AUDIO_TUNABLES)).toEqual({
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: true,
      highpassFilter: true,
    });
    expect(
      toGetUserMediaConstraints(
        { ...DEFAULT_AUDIO_TUNABLES, noiseSuppression: false, highpassFilter: false },
        'native',
      ),
    ).toEqual({
      echoCancellation: true,
      noiseSuppression: false,
      autoGainControl: true,
      highpassFilter: false,
    });
  });

  it('web: standard names plus mono, no highpassFilter', () => {
    expect(toGetUserMediaConstraints({ ...DEFAULT_AUDIO_TUNABLES, autoGainControl: false }, 'web')).toEqual({
      channelCount: 1,
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: false,
    });
  });

  it('tolerates garbage input', () => {
    expect(toGetUserMediaConstraints(null as unknown as AudioTunables)).toEqual({
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: true,
      highpassFilter: true,
    });
  });
});

describe('captureConstraintsDiffer', () => {
  it('flags only capture-affecting fields', () => {
    expect(
      captureConstraintsDiffer(DEFAULT_AUDIO_TUNABLES, { ...DEFAULT_AUDIO_TUNABLES, opusDtx: true }),
    ).toBe(false);
    for (const key of [
      'noiseSuppression',
      'autoGainControl',
      'echoCancellation',
      'highpassFilter',
    ] as const) {
      expect(
        captureConstraintsDiffer(DEFAULT_AUDIO_TUNABLES, { ...DEFAULT_AUDIO_TUNABLES, [key]: false }),
      ).toBe(true);
    }
  });
});

describe('describeTunables', () => {
  it('prints one stable line', () => {
    expect(describeTunables(DEFAULT_AUDIO_TUNABLES)).toBe(
      'ns=on agc=on aec=on hpf=on opus=24000bps fec=on dtx=off ptime=20ms',
    );
    expect(
      describeTunables({
        noiseSuppression: false,
        autoGainControl: false,
        echoCancellation: true,
        highpassFilter: false,
        opusBitrateBps: 64_000,
        opusFec: false,
        opusDtx: true,
        opusPacketTimeMs: 60,
      }),
    ).toBe('ns=off agc=off aec=on hpf=off opus=64000bps fec=off dtx=on ptime=60ms');
  });
});
