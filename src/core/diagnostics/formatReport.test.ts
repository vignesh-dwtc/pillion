import { DEFAULT_AUDIO_TUNABLES } from '../../platform/audio/AudioTunables';
import type { SessionSnapshot } from '../session/types';
import { formatDiagnosticsReport } from './formatReport';
import type { DiagnosticsReportInput } from './types';

const SECRET_B64 = 'Zm9vYmFyYmF6cXV4MTIzNDU2Nzg5MGFiY2RlZmdoaWo';
const PAIR_ID = 'AAECAwQFBgcICQoLDA0ODw';

const session: SessionSnapshot = {
  state: 'connected',
  role: 'host',
  pairId: PAIR_ID,
  muted: false,
  local: { headsetConnected: true, interruption: 'none', batteryPct: 77 },
  peer: {
    name: 'Pillion',
    muted: true,
    headsetConnected: true,
    batteryPct: 40,
    charging: false,
    interruption: 'none',
    updatedAt: 1_700_000_000_000,
  },
  transport: 'wifi-direct',
  generation: 3,
  attempt: 0,
  connectedAt: 1_700_000_000_000,
  error: null,
};

function input(overrides: Partial<DiagnosticsReportInput> = {}): DiagnosticsReportInput {
  return {
    generatedAt: 1_700_000_065_000,
    appVersion: '0.1.0',
    platform: 'android',
    osVersion: '15',
    deviceModel: 'Test Phone',
    session,
    interfaces: [{ name: 'wlan0', kind: 'wifi', addresses: ['192.168.49.1'], up: true, multicast: true }],
    stats: {
      timestamp: 1_700_000_064_000,
      connectionState: 'connected',
      selectedPair: null,
      localCandidates: [
        { id: 'c1', type: 'host', protocol: 'udp', address: '192.168.49.1', port: 5000, networkType: 'wifi' },
      ],
      remoteCandidates: [],
      rttMs: 12,
      jitterMs: 2.5,
      packetsSent: 10,
      packetsReceived: 9,
      packetsLost: 1,
      bytesSent: 1000,
      bytesReceived: 900,
      inputLevel: 0.1,
      outputLevel: null,
      codec: 'opus/48000/2',
    },
    sample: null,
    audio: null,
    battery: { levelPct: 77, charging: false },
    tunables: DEFAULT_AUDIO_TUNABLES,
    log: [
      {
        t: 1_700_000_000_000,
        level: 'info',
        tag: 'session',
        message: 'state linking -> connected',
        data: { b: 2, a: 'x y' },
      },
      {
        t: 1_700_000_001_000,
        level: 'warn',
        tag: 'link',
        message: `leaked ${SECRET_B64}`,
        data: { secret: SECRET_B64, hint: SECRET_B64 },
      },
    ],
    ...overrides,
  };
}

describe('formatDiagnosticsReport', () => {
  it('is deterministic for a given input and independent of key order', () => {
    const a = formatDiagnosticsReport(input());
    const b = formatDiagnosticsReport(input());
    expect(a).toBe(b);
    const shuffledTunables = Object.fromEntries(
      Object.entries(DEFAULT_AUDIO_TUNABLES).reverse(),
    ) as typeof DEFAULT_AUDIO_TUNABLES;
    expect(formatDiagnosticsReport(input({ tunables: shuffledTunables }))).toBe(a);
  });

  it('contains the sections and key facts', () => {
    const text = formatDiagnosticsReport(input());
    for (const heading of [
      '== Session ==',
      '== Network interfaces ==',
      '== Media ==',
      '== Audio route ==',
      '== Battery ==',
      '== Audio tunables ==',
      '== Log (2 entries',
    ]) {
      expect(text).toContain(heading);
    }
    expect(text).toContain('State: connected');
    expect(text).toContain('Generation: 3');
    expect(text).toContain('wlan0 [wifi] up');
    expect(text).toContain('Generated: 2023-11-14T22:14:25.000Z');
    expect(text).toContain('Connected since: 2023-11-14T22:13:20.000Z (up 1m 05s)');
    expect(text).toContain('opusBitrateBps: 24000');
    expect(text).toContain('a="x y" b=2');
    expect(text.endsWith('\n')).toBe(true);
  });

  it('never contains a secret: not in log entries, data, or elsewhere', () => {
    const text = formatDiagnosticsReport(input());
    expect(text).not.toContain(SECRET_B64);
    expect(text).toContain('secret=[redacted]');
    // Only a prefix of the non-secret pair id is shown.
    expect(text).not.toContain(PAIR_ID);
    expect(text).toContain(`${PAIR_ID.slice(0, 8)}...`);
  });

  it('handles missing data: no session, no stats, no interfaces, empty log, error present', () => {
    const text = formatDiagnosticsReport(
      input({
        stats: null,
        battery: null,
        interfaces: [],
        log: [],
        osVersion: null,
        deviceModel: null,
        session: {
          ...session,
          state: 'reconnecting',
          peer: null,
          connectedAt: null,
          pairId: null,
          error: { code: 'link-unavailable', message: 'Lost.', recoverable: true, at: 1_700_000_050_000 },
        },
      }),
    );
    expect(text).toContain('No media session.');
    expect(text).toContain('No interfaces reported.');
    expect(text).toContain('Partner: none');
    expect(text).toContain('Connected since: not connected');
    expect(text).toContain('Error: link-unavailable (recoverable)');
    expect(text).toContain('device: unknown');
    expect(text).toContain('== Log (0 entries');
  });

  it('survives non-finite numbers without throwing', () => {
    expect(() =>
      formatDiagnosticsReport(input({ generatedAt: NaN, session: { ...session, connectedAt: NaN } })),
    ).not.toThrow();
  });
});
