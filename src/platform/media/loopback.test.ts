import { DEFAULT_AUDIO_TUNABLES } from '../audio/AudioTunables';
import { createMediaEngine } from './createMediaEngine';
import { MediaError, type MediaEngine } from './MediaEngine';
import { runLoopbackSelfTest, startLoopbackSelfTest, type LoopbackProgress } from './loopback';
import { fakeWebRtc, resetFakeWebRtc } from './testing/fakeLivekitWebRtc';

jest.mock('@livekit/react-native-webrtc', () => jest.requireActual('./testing/fakeLivekitWebRtc'));

beforeEach(() => {
  resetFakeWebRtc();
  fakeWebRtc.autoGather = true;
  fakeWebRtc.autoConnect = true;
});

const options = {
  tunables: DEFAULT_AUDIO_TUNABLES,
  durationMs: 30,
  sampleIntervalMs: 10,
  connectTimeoutMs: 500,
};

describe('loopback self-test over the native engine (mocked package)', () => {
  it('connects a sending and a receive-only session in one process and reports bytes both ends', async () => {
    const progress: LoopbackProgress[] = [];
    const result = await runLoopbackSelfTest(createMediaEngine(), {
      ...options,
      onProgress: (p) => progress.push(p),
    });

    expect(result).toMatchObject({
      ok: true,
      failure: null,
      message: null,
      bytesSent: 1000,
      bytesReceived: 900,
    });
    expect(result.packetsLost).toBe(1);
    expect(result.connectMs).not.toBeNull();
    expect(result.durationMs).toBeGreaterThanOrEqual(30);

    const [sender, receiver] = fakeWebRtc.peerConnections;
    expect(fakeWebRtc.peerConnections).toHaveLength(2);
    expect(sender!.senders).toHaveLength(1); // sendLocalAudio: true
    expect(receiver!.senders).toHaveLength(0); // sendLocalAudio: false
    expect(sender!.localDescription!.type).toBe('offer');
    expect(receiver!.localDescription!.type).toBe('answer');
    // remote audio: the receiver plays it, the sender's (empty) remote track is silenced
    expect(receiver!.remoteTrack!.volume).toBeNull();
    expect(sender!.remoteTrack?.volume ?? 0).toBe(0);
    // candidates were trickled both ways
    expect(sender!.addedCandidates).toHaveLength(1);
    expect(receiver!.addedCandidates).toHaveLength(1);
    // everything is released afterwards
    expect(fakeWebRtc.peerConnections.every((pc) => pc.closed)).toBe(true);
    expect(fakeWebRtc.streams[0]!.released).toBe(true);
    expect(progress.map((p) => p.phase)).toEqual(
      expect.arrayContaining(['starting', 'negotiating', 'connecting', 'running', 'finished']),
    );
    expect(progress.find((p) => p.phase === 'running')?.sender?.bytesSent).toBe(1000);
  });

  it('fails with connect-timeout when ICE never connects, and still releases everything', async () => {
    fakeWebRtc.autoConnect = false;
    const result = await runLoopbackSelfTest(createMediaEngine(), { ...options, connectTimeoutMs: 20 });
    expect(result).toMatchObject({ ok: false, failure: 'connect-timeout', connectMs: null });
    expect(fakeWebRtc.peerConnections.every((pc) => pc.closed)).toBe(true);
    expect(fakeWebRtc.streams[0]!.released).toBe(true);
  });

  it('fails with no-audio when connected but no bytes arrive', async () => {
    fakeWebRtc.statsFor = () => new Map();
    const result = await runLoopbackSelfTest(createMediaEngine(), options);
    expect(result).toMatchObject({ ok: false, failure: 'no-audio', bytesSent: 0, bytesReceived: 0 });
  });

  it('reports a refused microphone as permission', async () => {
    fakeWebRtc.getUserMediaError = { name: 'SecurityError', message: 'Permission denied.' };
    const result = await runLoopbackSelfTest(createMediaEngine(), options);
    expect(result).toMatchObject({ ok: false, failure: 'permission' });
    expect(fakeWebRtc.peerConnections).toHaveLength(0);
  });

  it('reports a connection failure while running', async () => {
    const run = startLoopbackSelfTest(createMediaEngine(), { ...options, durationMs: 1_000 });
    await new Promise((resolve) => setTimeout(resolve, 20));
    fakeWebRtc.peerConnections[1]!.setConnectionState('failed');
    const result = await run.result;
    expect(result).toMatchObject({ ok: false, failure: 'connection-failed', message: 'receiver failed' });
    expect(fakeWebRtc.peerConnections.every((pc) => pc.closed)).toBe(true);
  });

  it('cancel() ends the test early and releases everything', async () => {
    const run = startLoopbackSelfTest(createMediaEngine(), { ...options, durationMs: 60_000 });
    await new Promise((resolve) => setTimeout(resolve, 20));
    run.cancel();
    const result = await run.result;
    expect(result).toMatchObject({ ok: false, failure: 'cancelled' });
    expect(fakeWebRtc.peerConnections.every((pc) => pc.closed)).toBe(true);
    run.cancel(); // harmless after the end
  });

  it('always stops the engine, even when the engine itself throws', async () => {
    const stop = jest.fn(async () => undefined);
    const engine: MediaEngine = {
      start: async () => undefined,
      createSession: async () => {
        throw new MediaError('unsupported', 'no RTCPeerConnection');
      },
      setMuted: () => undefined,
      setTunables: async () => undefined,
      stop,
    };
    const result = await runLoopbackSelfTest(engine, options);
    expect(result).toMatchObject({ ok: false, failure: 'unsupported', message: 'no RTCPeerConnection' });
    expect(stop).toHaveBeenCalledTimes(1);
  });
});
