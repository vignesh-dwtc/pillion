import { DEFAULT_AUDIO_TUNABLES, type AudioTunables } from '../audio/AudioTunables';

import { audioConstraintsFor, mapConnectionState, mapStatsReport, mungeOpusSdp } from './webMediaHelpers.web';

/** Chromium-style offer with one audio m-section (abridged but structurally faithful). */
const CHROME_OFFER = [
  'v=0',
  'o=- 4611731400430051336 2 IN IP4 127.0.0.1',
  's=-',
  't=0 0',
  'a=group:BUNDLE 0',
  'm=audio 9 UDP/TLS/RTP/SAVPF 111 63 9 0 8 13 110 126',
  'c=IN IP4 0.0.0.0',
  'a=rtcp:9 IN IP4 0.0.0.0',
  'a=mid:0',
  'a=sendrecv',
  'a=rtcp-mux',
  'a=rtpmap:111 opus/48000/2',
  'a=rtcp-fb:111 transport-cc',
  'a=fmtp:111 minptime=10;useinbandfec=1',
  'a=rtpmap:63 red/48000/2',
  'a=fmtp:63 111/111',
  'a=rtpmap:9 G722/8000',
  'a=rtpmap:0 PCMU/8000',
  'a=ssrc:1 cname:abc',
  '',
].join('\r\n');

const tunables = (overrides: Partial<AudioTunables> = {}): AudioTunables => ({
  ...DEFAULT_AUDIO_TUNABLES,
  ...overrides,
});

describe('mungeOpusSdp', () => {
  it('rewrites the Opus fmtp line for the default tunables and adds ptime', () => {
    const munged = mungeOpusSdp(CHROME_OFFER, tunables());
    const lines = munged.split('\r\n');
    expect(lines).toContain(
      'a=fmtp:111 minptime=10;useinbandfec=1;usedtx=0;maxaveragebitrate=24000;stereo=0;sprop-stereo=0',
    );
    expect(lines).toContain('a=ptime:20');
    expect(lines.filter((line) => line.startsWith('a=fmtp:111'))).toHaveLength(1);
  });

  it('reflects each tunable: FEC off, DTX on, bitrate, packet time', () => {
    const munged = mungeOpusSdp(
      CHROME_OFFER,
      tunables({ opusFec: false, opusDtx: true, opusBitrateBps: 32_000, opusPacketTimeMs: 40 }),
    );
    expect(munged).toContain('useinbandfec=0');
    expect(munged).toContain('usedtx=1');
    expect(munged).toContain('maxaveragebitrate=32000');
    expect(munged).toContain('a=ptime:40');
    expect(munged).not.toContain('a=ptime:20');
  });

  it('leaves every other line untouched and keeps CRLF and the trailing newline', () => {
    const munged = mungeOpusSdp(CHROME_OFFER, tunables());
    const untouched = (sdp: string) =>
      sdp.split('\r\n').filter((line) => !line.startsWith('a=fmtp:111') && !line.startsWith('a=ptime:'));
    expect(untouched(munged)).toEqual(untouched(CHROME_OFFER));
    expect(munged.endsWith('\r\n')).toBe(true);
    expect(munged).not.toMatch(/[^\r]\n/);
  });

  it('places the fmtp line right after the Opus rtpmap when the SDP had none', () => {
    const withoutFmtp = CHROME_OFFER.replace('a=fmtp:111 minptime=10;useinbandfec=1\r\n', '');
    const lines = mungeOpusSdp(withoutFmtp, tunables()).split('\r\n');
    const rtpmap = lines.indexOf('a=rtpmap:111 opus/48000/2');
    expect(lines[rtpmap + 1]).toMatch(/^a=fmtp:111 useinbandfec=1;usedtx=0;maxaveragebitrate=24000/);
  });

  it('is idempotent', () => {
    const once = mungeOpusSdp(CHROME_OFFER, tunables());
    expect(mungeOpusSdp(once, tunables())).toBe(once);
  });

  it('returns an SDP without Opus unchanged, and only touches audio sections', () => {
    const noOpus = CHROME_OFFER.replace(/a=rtpmap:111 opus\/48000\/2/, 'a=rtpmap:111 PCMA/8000');
    expect(mungeOpusSdp(noOpus, tunables())).toBe(noOpus);

    const video = ['m=video 9 UDP/TLS/RTP/SAVPF 96', 'a=rtpmap:96 VP8/90000', 'a=fmtp:96 x=1', ''].join(
      '\r\n',
    );
    const both = CHROME_OFFER.replace(/\r\n$/, '\r\n') + video;
    const lines = mungeOpusSdp(both, tunables()).split('\r\n');
    expect(lines).toContain('a=fmtp:96 x=1');
    expect(lines.filter((line) => line.startsWith('a=ptime:'))).toHaveLength(1);
  });

  it('copes with bare LF line endings', () => {
    const lf = CHROME_OFFER.replace(/\r\n/g, '\n');
    const munged = mungeOpusSdp(lf, tunables());
    expect(munged).not.toContain('\r');
    expect(munged).toContain('usedtx=0');
  });
});

describe('audioConstraintsFor', () => {
  it('maps the tunables to mono getUserMedia constraints', () => {
    expect(audioConstraintsFor(tunables({ noiseSuppression: false, autoGainControl: false }))).toEqual({
      channelCount: 1,
      echoCancellation: true,
      noiseSuppression: false,
      autoGainControl: false,
    });
  });
});

describe('mapConnectionState', () => {
  it.each([
    ['new', 'new'],
    ['connecting', 'checking'],
    ['checking', 'checking'],
    ['connected', 'connected'],
    ['completed', 'connected'],
    ['disconnected', 'disconnected'],
    ['failed', 'failed'],
    ['closed', 'closed'],
    ['something-else', 'new'],
  ])('%s -> %s', (input, expected) => {
    expect(mapConnectionState(input)).toBe(expected);
  });
});

/** A report shaped like Chromium's getStats() for a connected audio call. */
function chromeReport(): Map<string, Record<string, unknown>> {
  const entries: Record<string, unknown>[] = [
    { id: 'T01', type: 'transport', selectedCandidatePairId: 'CP1' },
    {
      id: 'CP1',
      type: 'candidate-pair',
      state: 'succeeded',
      nominated: true,
      localCandidateId: 'LC1',
      remoteCandidateId: 'RC1',
      currentRoundTripTime: 0.004,
    },
    { id: 'CP2', type: 'candidate-pair', state: 'failed', localCandidateId: 'LC2', remoteCandidateId: 'RC1' },
    {
      id: 'LC1',
      type: 'local-candidate',
      candidateType: 'host',
      protocol: 'udp',
      address: '192.0.2.2',
      port: 50123,
      networkType: 'ethernet',
    },
    {
      id: 'LC2',
      type: 'local-candidate',
      candidateType: 'host',
      protocol: 'tcp',
      address: '192.0.2.2',
      port: 9,
    },
    {
      id: 'RC1',
      type: 'remote-candidate',
      candidateType: 'host',
      protocol: 'udp',
      address: '192.0.2.3',
      port: 40001,
    },
    { id: 'OA', type: 'outbound-rtp', kind: 'audio', codecId: 'CO', packetsSent: 120, bytesSent: 9_600 },
    {
      id: 'IA',
      type: 'inbound-rtp',
      kind: 'audio',
      codecId: 'CO',
      packetsReceived: 118,
      bytesReceived: 9_440,
      packetsLost: 2,
      jitter: 0.0031,
      audioLevel: 0.25,
    },
    { id: 'RIA', type: 'remote-inbound-rtp', kind: 'audio', roundTripTime: 0.006, jitter: 0.002 },
    { id: 'MS', type: 'media-source', kind: 'audio', audioLevel: 0.5 },
    { id: 'CO', type: 'codec', mimeType: 'audio/opus', clockRate: 48000, channels: 2 },
    { id: 'OV', type: 'outbound-rtp', kind: 'video', packetsSent: 999, bytesSent: 999 },
  ];
  return new Map(entries.map((entry) => [entry.id as string, entry]));
}

describe('mapStatsReport', () => {
  it('maps a connected Chromium audio call to MediaStats', () => {
    const stats = mapStatsReport(chromeReport(), 'connected', 1234);
    expect(stats).toMatchObject({
      timestamp: 1234,
      connectionState: 'connected',
      packetsSent: 120,
      packetsReceived: 118,
      packetsLost: 2,
      bytesSent: 9_600,
      bytesReceived: 9_440,
      inputLevel: 0.5,
      outputLevel: 0.25,
      codec: 'opus/48000/2',
    });
    expect(stats.jitterMs).toBeCloseTo(3.1, 5);
    expect(stats.rttMs).toBeCloseTo(4, 5);
    expect(stats.selectedPair).toEqual({
      local: {
        id: 'LC1',
        type: 'host',
        protocol: 'udp',
        address: '192.0.2.2',
        port: 50123,
        networkType: 'ethernet',
      },
      remote: {
        id: 'RC1',
        type: 'host',
        protocol: 'udp',
        address: '192.0.2.3',
        port: 40001,
        networkType: null,
      },
      state: 'succeeded',
      rttMs: 4,
    });
  });

  it('lists every gathered local and remote candidate', () => {
    const stats = mapStatsReport(chromeReport(), 'connected', 0);
    expect(stats.localCandidates.map((candidate) => candidate.id).sort()).toEqual(['LC1', 'LC2']);
    expect(stats.remoteCandidates.map((candidate) => candidate.id)).toEqual(['RC1']);
    expect(stats.localCandidates.find((candidate) => candidate.id === 'LC2')?.protocol).toBe('tcp');
  });

  it('ignores video streams when summing audio counters', () => {
    expect(mapStatsReport(chromeReport(), 'connected', 0).bytesSent).toBe(9_600);
  });

  it('falls back to the nominated succeeded pair when the transport names none (Firefox style)', () => {
    const report = chromeReport();
    report.delete('T01');
    expect(mapStatsReport(report, 'connected', 0).selectedPair?.local.id).toBe('LC1');
  });

  it('uses the remote-inbound round trip when no pair is selected', () => {
    const report = chromeReport();
    report.delete('T01');
    report.delete('CP1');
    report.delete('CP2');
    const stats = mapStatsReport(report, 'checking', 0);
    expect(stats.selectedPair).toBeNull();
    expect(stats.rttMs).toBeCloseTo(6, 5);
  });

  it('reports zeros and nulls for an empty report', () => {
    expect(mapStatsReport(new Map(), 'new', 7)).toEqual({
      timestamp: 7,
      connectionState: 'new',
      selectedPair: null,
      localCandidates: [],
      remoteCandidates: [],
      rttMs: null,
      jitterMs: null,
      packetsSent: 0,
      packetsReceived: 0,
      packetsLost: 0,
      bytesSent: 0,
      bytesReceived: 0,
      inputLevel: null,
      outputLevel: null,
      codec: null,
    });
  });

  it('keeps mDNS candidate hostnames as the address and marks unknown types', () => {
    const report = new Map<string, Record<string, unknown>>([
      [
        'LC',
        {
          id: 'LC',
          type: 'local-candidate',
          candidateType: 'weird',
          protocol: 'quic',
          address: 'a1b2.local',
          port: 5,
        },
      ],
    ]);
    expect(mapStatsReport(report, 'new', 0).localCandidates[0]).toEqual({
      id: 'LC',
      type: 'unknown',
      protocol: 'unknown',
      address: 'a1b2.local',
      port: 5,
      networkType: null,
    });
  });
});
