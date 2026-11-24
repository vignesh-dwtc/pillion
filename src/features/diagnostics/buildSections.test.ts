import type { DiagnosticsReportInput } from '../../core/diagnostics/types';
import { SAMPLE_DIAGNOSTICS, SAMPLE_NOW } from './__fixtures__/sampleDiagnostics';

import { buildDiagnosticsSections, sectionsToText, TRANSPORT_LABEL } from './buildSections';

const ids = (input: DiagnosticsReportInput) => buildDiagnosticsSections(input).map((s) => s.id);

describe('buildDiagnosticsSections', () => {
  it('covers every section the brief asks for, in a stable order', () => {
    expect(ids(SAMPLE_DIAGNOSTICS)).toEqual([
      'app',
      'session',
      'transport',
      'interfaces',
      'ice',
      'quality',
      'levels',
      'route',
      'battery',
      'log',
    ]);
  });

  it('shows session, transport, ICE, quality, levels, route and battery values from the input', () => {
    const text = sectionsToText('t', SAMPLE_NOW, buildDiagnosticsSections(SAMPLE_DIAGNOSTICS));
    expect(text).toContain('State: connected');
    expect(text).toContain('Transport: LAN (shared Wi-Fi)');
    expect(text).toContain('wlan0 (wifi)');
    expect(text).toContain('Gathered locally (2)');
    expect(text).toContain('Received from partner (1)');
    expect(text).toContain('Selected pair: 192.168.1.23:50321 (wifi) <-> 192.168.1.41:49152 (wifi)');
    expect(text).toContain('Round-trip time: 4 ms');
    expect(text).toContain('Jitter: 2.1 ms');
    expect(text).toContain('Packet loss: 0.4 %');
    expect(text).toContain('Bitrate out: 23.8 kbps');
    expect(text).toContain('Input (your microphone): 42 %');
    expect(text).toContain('Active device: Sample earbuds (bluetooth-sco)');
    expect(text).toContain('Level: 81 %');
    expect(text).toContain('Connected for: 2 min 5 s');
  });

  it('renders missing live data as n/a instead of crashing (idle phone, no stats yet)', () => {
    const idle: DiagnosticsReportInput = {
      ...SAMPLE_DIAGNOSTICS,
      session: {
        ...SAMPLE_DIAGNOSTICS.session,
        state: 'idle',
        role: null,
        pairId: null,
        peer: null,
        transport: null,
        connectedAt: null,
      },
      interfaces: [],
      stats: null,
      sample: null,
      audio: null,
      battery: null,
      log: [],
    };
    const text = sectionsToText('t', SAMPLE_NOW, buildDiagnosticsSections(idle));
    expect(text).toContain('Transport: none');
    expect(text).toContain('Round-trip time: n/a');
    expect(text).toContain('Audio route: n/a');
    expect(text).toContain('Battery: n/a');
    expect(text).toContain('No interfaces reported');
    expect(text).toContain('No log entries yet');
    expect(text).toContain('Connected for: not connected');
    expect(text).toContain('Partner: no state received yet');
  });

  it('exposes level bars only for the audio levels section', () => {
    const levels = buildDiagnosticsSections(SAMPLE_DIAGNOSTICS).find((s) => s.id === 'levels');
    expect(levels?.rows.map((r) => r.level)).toEqual([0.42, 0.18]);
  });

  it('keeps only the latest log entries, newest last', () => {
    const many = Array.from({ length: 30 }, (_, i) => ({
      t: SAMPLE_NOW + i,
      level: 'info' as const,
      tag: 'x',
      message: `m${i}`,
    }));
    const log = buildDiagnosticsSections({ ...SAMPLE_DIAGNOSTICS, log: many }).find((s) => s.id === 'log');
    expect(log?.rows).toHaveLength(20);
    expect(log?.rows.at(-1)?.value).toContain('m29');
    expect(log?.rows[0]?.value).toContain('m10');
  });

  it('labels every transport kind', () => {
    expect(Object.keys(TRANSPORT_LABEL).sort()).toEqual(['lan', 'memory', 'web-relay', 'wifi-direct']);
  });

  it('reports a session error with its recoverability', () => {
    const withError: DiagnosticsReportInput = {
      ...SAMPLE_DIAGNOSTICS,
      session: {
        ...SAMPLE_DIAGNOSTICS.session,
        error: { code: 'no-headset', message: 'No headset connected', recoverable: false, at: SAMPLE_NOW },
      },
    };
    const text = sectionsToText('t', SAMPLE_NOW, buildDiagnosticsSections(withError));
    expect(text).toContain('Last error: no-headset: No headset connected');
    expect(text).toContain('Error recoverable: No');
  });
});

describe('sectionsToText', () => {
  it('writes a titled, deterministic report', () => {
    const sections = buildDiagnosticsSections(SAMPLE_DIAGNOSTICS);
    const a = sectionsToText('Pillion diagnostics', SAMPLE_NOW, sections);
    const b = sectionsToText('Pillion diagnostics', SAMPLE_NOW, sections);
    expect(a).toBe(b);
    expect(a.startsWith('Pillion diagnostics\nGenerated: 2026-11-17T09:30:00.000Z')).toBe(true);
    expect(a).toContain('== Session ==');
    expect(a).toContain('== Log (latest entries) ==');
  });

  it('indents multi-line values under their label', () => {
    const text = sectionsToText('t', SAMPLE_NOW, buildDiagnosticsSections(SAMPLE_DIAGNOSTICS));
    expect(text).toContain('wlan0 (wifi):\n  up, multicast yes\n  192.168.1.23');
  });

  it('never contains secret-bearing field names', () => {
    const text = sectionsToText('t', SAMPLE_NOW, buildDiagnosticsSections(SAMPLE_DIAGNOSTICS)).toLowerCase();
    expect(text).not.toContain('passphrase');
    expect(text).not.toContain('secret');
  });
});
