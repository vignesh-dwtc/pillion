import {
  AUDIO_TUNABLE_LIMITS,
  DEFAULT_AUDIO_TUNABLES,
  type AudioTunables,
} from '../../platform/audio/AudioTunables';

import {
  BITRATE_PRESETS,
  BITRATE_STEP_BPS,
  OPUS_TUNABLES,
  PROCESSING_TUNABLES,
  TUNABLE_COPY,
  changedTunables,
  stepBitrate,
} from './tunableFields';

describe('stepBitrate', () => {
  it('moves by one step and clamps at both limits', () => {
    expect(stepBitrate(24_000, 1)).toBe(24_000 + BITRATE_STEP_BPS);
    expect(stepBitrate(24_000, -1)).toBe(24_000 - BITRATE_STEP_BPS);
    expect(stepBitrate(AUDIO_TUNABLE_LIMITS.opusBitrateBps.max, 1)).toBe(
      AUDIO_TUNABLE_LIMITS.opusBitrateBps.max,
    );
    expect(stepBitrate(AUDIO_TUNABLE_LIMITS.opusBitrateBps.min, -1)).toBe(
      AUDIO_TUNABLE_LIMITS.opusBitrateBps.min,
    );
    expect(stepBitrate(7_000, -1)).toBe(AUDIO_TUNABLE_LIMITS.opusBitrateBps.min);
  });
});

describe('BITRATE_PRESETS', () => {
  it('stays within the limits and includes the default', () => {
    for (const bps of BITRATE_PRESETS) {
      expect(bps).toBeGreaterThanOrEqual(AUDIO_TUNABLE_LIMITS.opusBitrateBps.min);
      expect(bps).toBeLessThanOrEqual(AUDIO_TUNABLE_LIMITS.opusBitrateBps.max);
    }
    expect(BITRATE_PRESETS).toContain(DEFAULT_AUDIO_TUNABLES.opusBitrateBps);
  });
});

describe('changedTunables', () => {
  it('is empty at the defaults', () => {
    expect(changedTunables(DEFAULT_AUDIO_TUNABLES)).toEqual([]);
  });

  it('lists exactly the fields that differ', () => {
    const edited: AudioTunables = { ...DEFAULT_AUDIO_TUNABLES, opusDtx: true, opusBitrateBps: 32_000 };
    expect(changedTunables(edited)).toEqual(['opusBitrateBps', 'opusDtx']);
  });
});

describe('editor coverage', () => {
  it('shows every AudioTunables field exactly once and has copy for each', () => {
    const shown = new Set<string>([
      ...PROCESSING_TUNABLES,
      ...OPUS_TUNABLES,
      'opusBitrateBps',
      'opusPacketTimeMs',
    ]);
    expect([...shown].sort()).toEqual(Object.keys(DEFAULT_AUDIO_TUNABLES).sort());
    expect(Object.keys(TUNABLE_COPY).sort()).toEqual(Object.keys(DEFAULT_AUDIO_TUNABLES).sort());
  });
});
