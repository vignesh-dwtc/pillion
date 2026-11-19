import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { candidateInfo, mapStatsReport, type RawStat } from './stats';

interface StatsFixture {
  userAgent: string;
  connectionState: 'new' | 'connected';
  entries: RawStat[];
}
const load = (name: string): StatsFixture =>
  JSON.parse(readFileSync(join(__dirname, '__fixtures__', name), 'utf8')) as StatsFixture;

describe('mapStatsReport on real Chromium fixtures', () => {
  it('maps a connected call (side A, which has RTCP round-trip data)', () => {
    const f = load('stats-connected.chromium.json');
    expect(f.userAgent).toContain('Chrome');
    const s = mapStatsReport(f.entries, 1234, 'connected');
    expect(s.timestamp).toBe(1234);
    expect(s.connectionState).toBe('connected');
    expect(s.packetsSent).toBe(407);
    expect(s.bytesSent).toBe(19571);
    expect(s.packetsReceived).toBe(407);
    expect(s.bytesReceived).toBe(19571);
    expect(s.packetsLost).toBe(0);
    expect(s.jitterMs).toBeCloseTo(1, 6); // inbound-rtp jitter 0.001 s
    expect(s.rttMs).toBeCloseTo(1, 6); // remote-inbound-rtp roundTripTime 0.001 s
    expect(s.inputLevel).toBeCloseTo(0.0416272, 6);
    expect(s.outputLevel).toBe(0);
    expect(s.codec).toBe('opus/48000/2');
    expect(s.selectedPair).toEqual({
      local: {
        id: 'IvlDP3xCj',
        type: 'host',
        protocol: 'udp',
        address: null,
        port: 51716,
        networkType: 'unknown',
      },
      remote: {
        id: 'IksmLb9R3',
        type: 'host',
        protocol: 'udp',
        address: null,
        port: 34527,
        networkType: null,
      },
      state: 'succeeded',
      rttMs: 1,
    });
  });

  it('lists every local candidate (including TCP) and the remote ones', () => {
    const s = mapStatsReport(load('stats-connected.chromium.json').entries, 1, 'connected');
    expect(s.localCandidates.map((c) => [c.id, c.protocol, c.port, c.type])).toEqual([
      ['INjF5XsC5', 'tcp', 9, 'host'],
      ['ImAgJmkAZ', 'tcp', 9, 'host'],
      ['IvlDP3xCj', 'udp', 51716, 'host'],
    ]);
    expect(s.remoteCandidates.map((c) => [c.id, c.protocol, c.port])).toEqual([['IksmLb9R3', 'udp', 34527]]);
  });

  it('side B: remote-inbound-rtp has no roundTripTime, so the candidate pair RTT (0 ms) is used', () => {
    const s = mapStatsReport(load('stats-connected-b.chromium.json').entries, 5, 'connected');
    expect(s.rttMs).toBe(0);
    expect(s.selectedPair?.rttMs).toBe(0);
    expect(s.selectedPair?.local.port).toBe(34527);
    expect(s.selectedPair?.remote.port).toBe(51716);
    expect(s.inputLevel).toBeCloseTo(0.061983, 6);
    expect(s.bytesSent).toBe(19571);
  });

  it('before connection: no pair, candidates present, counters zero, levels from the media source', () => {
    const f = load('stats-gathering.chromium.json');
    const s = mapStatsReport(f.entries, 9, 'checking');
    expect(s.connectionState).toBe('checking');
    expect(s.selectedPair).toBeNull();
    expect(s.localCandidates).toHaveLength(3);
    expect(s.remoteCandidates).toEqual([]);
    expect(s.rttMs).toBeNull();
    expect(s.jitterMs).toBeNull();
    expect(s.packetsSent).toBe(0);
    expect(s.bytesReceived).toBe(0);
    expect(s.outputLevel).toBeNull();
    expect(s.inputLevel).toBe(0);
    expect(s.codec).toBeNull();
  });

  it('accepts a Map and an array of [id, stats] pairs the same way (how the LiveKit fork delivers a report)', () => {
    const f = load('stats-connected.chromium.json');
    const asArray = mapStatsReport(f.entries, 1, 'connected');
    const asMap = mapStatsReport(new Map(f.entries.map((e) => [String(e.id), e])), 1, 'connected');
    const asPairs = mapStatsReport(
      f.entries.map((e) => [String(e.id), e] as [string, RawStat]),
      1,
      'connected',
    );
    expect(asMap).toEqual(asArray);
    expect(asPairs).toEqual(asArray);
  });
});

describe('mapStatsReport on an Android-shaped report (hand-written from StringUtils.statsToJSON)', () => {
  // Android differences handled here: no transport.selectedCandidatePairId in older libwebrtc (pair has
  // `selected`), `ip` instead of `address`, networkType 'wifi', ids in the Map key only, kind missing on some stats.
  const entries: [string, RawStat][] = [
    [
      'RTCInboundRTPAudioStream_1',
      {
        type: 'inbound-rtp',
        kind: 'audio',
        packetsReceived: 100,
        packetsLost: -2,
        bytesReceived: 5000,
        jitter: 0.012,
        audioLevel: 1.5,
        codecId: 'RTCCodec_1',
      },
    ],
    [
      'RTCOutboundRTPAudioStream_2',
      { type: 'outbound-rtp', kind: 'audio', packetsSent: 90, bytesSent: 4500, codecId: 'RTCCodec_1' },
    ],
    [
      'RTCRemoteInboundRtpAudioStream_2',
      { type: 'remote-inbound-rtp', kind: 'audio', jitter: 0.02, roundTripTime: 0.045 },
    ],
    ['RTCMediaStreamTrack_sender_1', { type: 'media-source', kind: 'audio', audioLevel: 0.25 }],
    ['RTCCodec_1', { type: 'codec', mimeType: 'audio/opus', clockRate: 48000, channels: 2 }],
    [
      'RTCIceCandidatePair_a',
      {
        type: 'candidate-pair',
        state: 'succeeded',
        selected: true,
        localCandidateId: 'L1',
        remoteCandidateId: 'R1',
        currentRoundTripTime: 0.05,
        bytesSent: 10,
      },
    ],
    [
      'RTCIceCandidatePair_b',
      {
        type: 'candidate-pair',
        state: 'failed',
        selected: false,
        localCandidateId: 'L2',
        remoteCandidateId: 'R1',
      },
    ],
    [
      'L1',
      {
        type: 'local-candidate',
        candidateType: 'host',
        protocol: 'udp',
        ip: '192.168.49.1',
        port: 40000,
        networkType: 'wifi',
      },
    ],
    [
      'L2',
      {
        type: 'local-candidate',
        candidateType: 'host',
        protocol: 'udp',
        ip: '10.0.0.5',
        port: 40001,
        networkType: 'cellular',
      },
    ],
    [
      'R1',
      { type: 'remote-candidate', candidateType: 'host', protocol: 'udp', ip: '192.168.49.2', port: 41000 },
    ],
  ];

  it('maps units, falls back to ip, takes the pair flagged selected, clamps loss and levels', () => {
    const s = mapStatsReport(new Map(entries), 77, 'connected');
    expect(s).toEqual({
      timestamp: 77,
      connectionState: 'connected',
      selectedPair: {
        local: {
          id: 'L1',
          type: 'host',
          protocol: 'udp',
          address: '192.168.49.1',
          port: 40000,
          networkType: 'wifi',
        },
        remote: {
          id: 'R1',
          type: 'host',
          protocol: 'udp',
          address: '192.168.49.2',
          port: 41000,
          networkType: null,
        },
        state: 'succeeded',
        rttMs: 50,
      },
      localCandidates: [
        {
          id: 'L1',
          type: 'host',
          protocol: 'udp',
          address: '192.168.49.1',
          port: 40000,
          networkType: 'wifi',
        },
        {
          id: 'L2',
          type: 'host',
          protocol: 'udp',
          address: '10.0.0.5',
          port: 40001,
          networkType: 'cellular',
        },
      ],
      remoteCandidates: [
        { id: 'R1', type: 'host', protocol: 'udp', address: '192.168.49.2', port: 41000, networkType: null },
      ],
      rttMs: 45,
      jitterMs: 12,
      packetsSent: 90,
      packetsReceived: 100,
      packetsLost: 0,
      bytesSent: 4500,
      bytesReceived: 5000,
      inputLevel: 0.25,
      outputLevel: 1,
      codec: 'opus/48000/2',
    });
  });

  it('prefers the transport selectedCandidatePairId over a flag', () => {
    const withTransport: [string, RawStat][] = [
      ...entries,
      ['T', { type: 'transport', selectedCandidatePairId: 'RTCIceCandidatePair_b' }],
    ];
    const s = mapStatsReport(withTransport, 1, 'connected');
    expect(s.selectedPair?.state).toBe('failed');
    expect(s.selectedPair?.local.id).toBe('L2');
  });

  it('falls back to the busiest nominated succeeded pair when nothing is flagged', () => {
    const e: RawStat[] = [
      {
        id: 'p1',
        type: 'candidate-pair',
        state: 'succeeded',
        nominated: true,
        bytesSent: 1,
        localCandidateId: 'a',
        remoteCandidateId: 'b',
      },
      {
        id: 'p2',
        type: 'candidate-pair',
        state: 'succeeded',
        nominated: true,
        bytesSent: 900,
        localCandidateId: 'c',
        remoteCandidateId: 'd',
      },
      { id: 'p3', type: 'candidate-pair', state: 'waiting', nominated: false },
    ];
    const s = mapStatsReport(e, 1, 'connected');
    expect(s.selectedPair?.local.id).toBe('c');
    expect(s.selectedPair?.remote.id).toBe('d');
    expect(s.selectedPair?.local.type).toBe('unknown'); // candidate entries missing from the report
  });
});

describe('mapStatsReport tolerance', () => {
  it('returns an all-empty MediaStats for nothing and for garbage, never throwing', () => {
    const empty = {
      timestamp: 3,
      connectionState: 'new' as const,
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
    };
    expect(mapStatsReport([], 3, 'new')).toEqual(empty);
    expect(mapStatsReport(new Map(), 3, 'new')).toEqual(empty);
    expect(mapStatsReport([null, 5, 'x', [], [1], { nope: 1 }, [['a', 'b']]], 3, 'new')).toEqual(empty);
    expect(mapStatsReport(null as never, 3, 'new')).toEqual(empty);
    expect(
      mapStatsReport(
        {
          forEach: () => {
            throw new Error('x');
          },
        },
        3,
        'new',
      ),
    ).toEqual(empty);
  });

  it('ignores NaN, strings and negative numbers; accepts numeric strings', () => {
    const s = mapStatsReport(
      [
        {
          id: 'i',
          type: 'inbound-rtp',
          kind: 'audio',
          packetsReceived: NaN,
          bytesReceived: '2500',
          jitter: 'x',
          audioLevel: -3,
          packetsLost: -9,
        },
        { id: 'o', type: 'outbound-rtp', kind: 'audio', packetsSent: Infinity, bytesSent: 12 },
      ],
      1,
      'connected',
    );
    expect(s.packetsReceived).toBe(0);
    expect(s.bytesReceived).toBe(2500);
    expect(s.jitterMs).toBeNull();
    expect(s.outputLevel).toBe(0);
    expect(s.packetsLost).toBe(0);
    expect(s.packetsSent).toBe(0);
    expect(s.bytesSent).toBe(12);
  });

  it('ignores video streams', () => {
    const s = mapStatsReport(
      [
        { id: 'v', type: 'inbound-rtp', kind: 'video', packetsReceived: 999, bytesReceived: 999 },
        { id: 'a', type: 'inbound-rtp', kind: 'audio', packetsReceived: 5, bytesReceived: 50 },
      ],
      1,
      'connected',
    );
    expect(s.packetsReceived).toBe(5);
    expect(s.bytesReceived).toBe(50);
  });

  it('sums several audio streams (a renegotiation leaves an old ssrc behind)', () => {
    const s = mapStatsReport(
      [
        { id: 'a', type: 'outbound-rtp', kind: 'audio', packetsSent: 5, bytesSent: 50 },
        { id: 'b', type: 'outbound-rtp', kind: 'audio', packetsSent: 7, bytesSent: 70 },
      ],
      1,
      'connected',
    );
    expect(s.packetsSent).toBe(12);
    expect(s.bytesSent).toBe(120);
  });

  it('codec: falls back to outbound, then to any audio codec except red/telephone-event', () => {
    const codecs: RawStat[] = [
      { id: 'c1', type: 'codec', mimeType: 'audio/red', clockRate: 48000, channels: 2 },
      { id: 'c2', type: 'codec', mimeType: 'audio/opus', clockRate: 48000 },
    ];
    expect(mapStatsReport(codecs, 1, 'connected').codec).toBe('opus/48000');
    expect(
      mapStatsReport(
        [...codecs, { id: 'o', type: 'outbound-rtp', kind: 'audio', codecId: 'c1' }],
        1,
        'connected',
      ).codec,
    ).toBe('red/48000/2');
  });
});

describe('candidateInfo', () => {
  it('normalises odd values', () => {
    expect(
      candidateInfo({
        id: 'x',
        candidateType: 'weird',
        protocol: 'UDP',
        address: '',
        ip: '1.2.3.4',
        port: '5',
      }),
    ).toEqual({
      id: 'x',
      type: 'unknown',
      protocol: 'udp',
      address: '1.2.3.4',
      port: 5,
      networkType: null,
    });
    expect(candidateInfo({}).protocol).toBe('unknown');
  });
});
