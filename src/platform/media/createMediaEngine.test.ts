import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { DEFAULT_AUDIO_TUNABLES, type AudioTunables } from '../audio/AudioTunables';
import { createMediaEngine, mapConnectionState, toCaptureError } from './createMediaEngine';
import { MediaError, type IceCandidateInit, type MediaConnectionState } from './MediaEngine';
import { applyOpusTunables, readOpusFmtp } from './sdp';
import { fakeWebRtc, resetFakeWebRtc, type FakePeerConnection } from './testing/fakeLivekitWebRtc';

jest.mock('@livekit/react-native-webrtc', () => jest.requireActual('./testing/fakeLivekitWebRtc'));

const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0));
const tunables = (patch: Partial<AudioTunables> = {}): AudioTunables => ({
  ...DEFAULT_AUDIO_TUNABLES,
  ...patch,
});

async function startedEngine(patch: Partial<AudioTunables> = {}, startMuted = false) {
  const engine = createMediaEngine();
  await engine.start({ tunables: tunables(patch), startMuted });
  return engine;
}

const lastPc = (): FakePeerConnection => {
  const pc = fakeWebRtc.peerConnections[fakeWebRtc.peerConnections.length - 1];
  if (!pc) throw new Error('no peer connection');
  return pc;
};

beforeEach(() => resetFakeWebRtc());

describe('WebRtcMediaEngine.start', () => {
  it('captures once with the native constraint keys and honours startMuted', async () => {
    await startedEngine({ noiseSuppression: false, highpassFilter: false }, true);
    expect(fakeWebRtc.streams).toHaveLength(1);
    const stream = fakeWebRtc.streams[0]!;
    expect(stream.constraints).toEqual({
      audio: {
        echoCancellation: true,
        noiseSuppression: false,
        autoGainControl: true,
        highpassFilter: false,
      },
    });
    expect(stream.tracks[0]!.enabled).toBe(false);
  });

  it('maps a refused permission (the package rejects a plain MediaStreamError object) to MediaError permission', async () => {
    fakeWebRtc.getUserMediaError = { name: 'SecurityError', message: 'Permission denied.' };
    const engine = createMediaEngine();
    await expect(engine.start({ tunables: tunables(), startMuted: false })).rejects.toMatchObject({
      name: 'MediaError',
      code: 'permission',
    });
  });

  it('maps any other capture failure to capture-failed and an empty stream too', async () => {
    fakeWebRtc.getUserMediaError = new TypeError('audio and/or video is required');
    await expect(
      createMediaEngine().start({ tunables: tunables(), startMuted: false }),
    ).rejects.toMatchObject({
      code: 'capture-failed',
    });
    resetFakeWebRtc();
    fakeWebRtc.getUserMediaNoTrack = true;
    await expect(
      createMediaEngine().start({ tunables: tunables(), startMuted: false }),
    ).rejects.toMatchObject({
      code: 'capture-failed',
    });
    expect(fakeWebRtc.streams[0]!.released).toBe(true);
  });

  it('toCaptureError keeps MediaErrors and names', () => {
    const original = new MediaError('unsupported');
    expect(toCaptureError(original)).toBe(original);
    expect(toCaptureError({ name: 'NotAllowedError' }).code).toBe('permission');
    expect(toCaptureError('boom').message).toBe('error: boom');
  });
});

describe('WebRtcMediaEngine.createSession', () => {
  it('creates a peer connection with no ICE servers per attempt and adds the microphone track', async () => {
    const engine = await startedEngine();
    await engine.createSession();
    await engine.createSession();
    expect(fakeWebRtc.peerConnections).toHaveLength(2);
    for (const pc of fakeWebRtc.peerConnections) {
      expect(pc.config).toEqual({ iceServers: [], bundlePolicy: 'max-bundle', rtcpMuxPolicy: 'require' });
      expect(pc.senders).toHaveLength(1);
      expect(pc.senders[0]!.track).toBe(fakeWebRtc.streams[0]!.tracks[0]);
    }
    expect(fakeWebRtc.streams).toHaveLength(1); // the microphone is captured once per ride
  });

  it('refuses a sending session before start, allows a receive-only one', async () => {
    const engine = createMediaEngine();
    await expect(engine.createSession()).rejects.toMatchObject({ code: 'closed' });
    const session = await engine.createSession({ sendLocalAudio: false });
    expect(lastPc().senders).toHaveLength(0);
    const offer = await session.createOffer();
    expect(lastPc().transceivers.map((t) => t.direction)).toEqual(['audio:recvonly']);
    expect(offer.sdp).toContain('a=recvonly');
  });

  it('maps a peer connection init failure to negotiation-failed', async () => {
    const engine = await startedEngine();
    fakeWebRtc.failPeerConnectionInit = true;
    await expect(engine.createSession()).rejects.toMatchObject({ code: 'negotiation-failed' });
  });

  it('silences remote audio when playRemoteAudio is false, leaves it alone otherwise', async () => {
    const engine = await startedEngine();
    const quiet = await engine.createSession({ playRemoteAudio: false });
    await quiet.acceptOffer({ type: 'offer', sdp: fakeWebRtc.offerSdp });
    expect(lastPc().remoteTrack!.volume).toBe(0);
    const loud = await engine.createSession();
    await loud.acceptOffer({ type: 'offer', sdp: fakeWebRtc.offerSdp });
    expect(lastPc().remoteTrack!.volume).toBeNull();
  });
});

describe('WebRtcMediaSession negotiation', () => {
  it('munges the LOCAL offer before setLocalDescription and returns exactly what was set', async () => {
    const t = tunables({ opusBitrateBps: 32_000, opusDtx: true, opusPacketTimeMs: 40 });
    const engine = await startedEngine(t);
    const session = await engine.createSession();
    const offer = await session.createOffer();
    const pc = lastPc();
    const expected = applyOpusTunables(fakeWebRtc.offerSdp, t);
    expect(pc.setLocalCalls).toEqual([{ type: 'offer', sdp: expected }]);
    expect(offer).toEqual({ type: 'offer', sdp: expected });
    expect(readOpusFmtp(offer.sdp)['111']).toBe(
      'minptime=40;useinbandfec=1;usedtx=1;maxaveragebitrate=32000;stereo=0;sprop-stereo=0',
    );
    expect(offer.sdp).toContain('a=ptime:40');
  });

  it('passes iceRestart through', async () => {
    const session = await (await startedEngine()).createSession();
    await session.createOffer({ iceRestart: true });
    await session.createOffer();
    expect(lastPc().offerOptions).toEqual([{ iceRestart: true }, undefined]);
  });

  it('applies the remote offer as is and munges the local answer', async () => {
    const engine = await startedEngine({ opusFec: false });
    const session = await engine.createSession();
    const answer = await session.acceptOffer({ type: 'offer', sdp: 'remote-offer-sdp' });
    const pc = lastPc();
    expect(pc.remoteDescription).toEqual({ type: 'offer', sdp: 'remote-offer-sdp' });
    expect(answer.type).toBe('answer');
    expect(answer.sdp).toBe(applyOpusTunables(fakeWebRtc.answerSdp, tunables({ opusFec: false })));
    expect(readOpusFmtp(answer.sdp)['111']).toContain('useinbandfec=0');
  });

  it('maps package errors to MediaError negotiation-failed', async () => {
    const engine = await startedEngine();
    const session = await engine.createSession();
    fakeWebRtc.failCreateOffer = true;
    await expect(session.createOffer()).rejects.toMatchObject({
      name: 'MediaError',
      code: 'negotiation-failed',
    });
    fakeWebRtc.failSetRemote = true;
    await expect(session.acceptOffer({ type: 'offer', sdp: 'x' })).rejects.toBeInstanceOf(MediaError);
    await expect(session.acceptAnswer({ type: 'answer', sdp: 'x' })).rejects.toMatchObject({
      code: 'negotiation-failed',
    });
  });
});

describe('ICE trickling', () => {
  it('buffers local candidates until the first subscriber, maps them, and forwards end-of-candidates as null', async () => {
    const session = await (await startedEngine()).createSession();
    const pc = lastPc();
    pc.emitCandidate({
      candidate: 'candidate:1 1 udp 1 192.0.2.1 5000 typ host',
      sdpMid: '0',
      sdpMLineIndex: 0,
    });
    const seen: (IceCandidateInit | null)[] = [];
    session.onLocalCandidate((c) => seen.push(c));
    pc.emitCandidate({ candidate: 'candidate:2 1 udp 1 192.0.2.2 5001 typ host', sdpMLineIndex: 0 });
    pc.emitCandidate(null);
    expect(seen).toEqual([
      { candidate: 'candidate:1 1 udp 1 192.0.2.1 5000 typ host', sdpMid: '0', sdpMLineIndex: 0 },
      { candidate: 'candidate:2 1 udp 1 192.0.2.2 5001 typ host', sdpMid: null, sdpMLineIndex: 0 },
      null,
    ]);
  });

  it('queues remote candidates until the remote description is applied, skips end-of-candidates', async () => {
    const session = await (await startedEngine()).createSession();
    const pc = lastPc();
    const c1 = { candidate: 'candidate:1 1 udp 1 192.0.2.9 6000 typ host', sdpMid: '0', sdpMLineIndex: 0 };
    await session.addRemoteCandidate(c1);
    await session.addRemoteCandidate(null);
    expect(pc.addedCandidates).toEqual([]);
    await session.createOffer();
    await session.acceptAnswer({ type: 'answer', sdp: fakeWebRtc.answerSdp });
    expect(pc.addedCandidates).toEqual([c1]);
    const c2 = { ...c1, candidate: 'candidate:2 1 udp 1 192.0.2.9 6001 typ host' };
    await session.addRemoteCandidate(c2);
    expect(pc.addedCandidates).toEqual([c1, c2]);
  });

  it('a rejected remote candidate does not fail the session', async () => {
    const session = await (await startedEngine()).createSession();
    await session.acceptOffer({ type: 'offer', sdp: fakeWebRtc.offerSdp });
    lastPc().addIceCandidate = () => Promise.reject(new Error('bad candidate'));
    await expect(
      session.addRemoteCandidate({ candidate: 'candidate:x', sdpMid: '0', sdpMLineIndex: 0 }),
    ).resolves.toBeUndefined();
  });
});

describe('connection state', () => {
  it('maps package states, dedupes repeats and replays the current state to a late subscriber', async () => {
    const session = await (await startedEngine()).createSession();
    const pc = lastPc();
    const states: MediaConnectionState[] = [];
    session.onState((s) => states.push(s));
    pc.setConnectionState('connecting');
    pc.setConnectionState('connecting');
    pc.setConnectionState('connected');
    pc.setConnectionState('disconnected');
    pc.setConnectionState('failed');
    expect(states).toEqual(['checking', 'connected', 'disconnected', 'failed']);
    const late: MediaConnectionState[] = [];
    session.onState((s) => late.push(s));
    await flush();
    expect(late).toEqual(['failed']);
  });

  it('mapConnectionState covers both state vocabularies', () => {
    expect(mapConnectionState('checking')).toBe('checking');
    expect(mapConnectionState('completed')).toBe('connected');
    expect(mapConnectionState('closed')).toBe('closed');
    expect(mapConnectionState(undefined)).toBe('new');
  });
});

describe('mute and tunables', () => {
  it('setMuted toggles track.enabled and survives before start', async () => {
    const early = createMediaEngine();
    expect(() => early.setMuted(true)).not.toThrow();
    const engine = await startedEngine();
    const track = fakeWebRtc.streams[0]!.tracks[0]!;
    engine.setMuted(true);
    expect(track.enabled).toBe(false);
    engine.setMuted(false);
    expect(track.enabled).toBe(true);
  });

  it('caps the sender bitrate once connected and again on a live tunables change', async () => {
    const engine = await startedEngine({ opusBitrateBps: 20_000 });
    const session = await engine.createSession();
    const pc = lastPc();
    const sender = pc.senders[0]!;
    await engine.setTunables(tunables({ opusBitrateBps: 30_000 }));
    expect(sender.setParametersCalls).toEqual([]); // not before negotiation
    pc.setConnectionState('connected');
    await flush();
    expect(sender.getParameters().encodings[0]!.maxBitrate).toBe(30_000);
    await engine.setTunables(tunables({ opusBitrateBps: 999_999 })); // clamped to the limit
    expect(sender.getParameters().encodings[0]!.maxBitrate).toBe(64_000);
    await session.close();
  });

  it('uses the new tunables for the next local description', async () => {
    const engine = await startedEngine();
    const session = await engine.createSession();
    await engine.setTunables(tunables({ opusPacketTimeMs: 60 }));
    const offer = await session.createOffer();
    expect(offer.sdp).toContain('a=ptime:60');
  });

  it('changing a capture constraint captures a new track, swaps it into live senders and releases the old one', async () => {
    const engine = await startedEngine();
    const session = await engine.createSession();
    const sender = lastPc().senders[0]!;
    engine.setMuted(true);
    await engine.setTunables(tunables({ echoCancellation: false }));
    expect(fakeWebRtc.streams).toHaveLength(2);
    const [old, fresh] = fakeWebRtc.streams;
    expect(fresh!.constraints).toMatchObject({ audio: { echoCancellation: false } });
    expect(sender.replaceTrackCalls).toEqual([fresh!.tracks[0]]);
    expect(fresh!.tracks[0]!.enabled).toBe(false); // keeps the mute state
    expect(old!.released).toBe(true);
    expect(old!.tracks[0]!.released).toBe(true);
    // a bitrate-only change does not re-capture
    await engine.setTunables(tunables({ echoCancellation: false, opusBitrateBps: 12_000 }));
    expect(fakeWebRtc.streams).toHaveLength(2);
    await session.close();
  });

  it('a failed re-capture keeps the old track and rejects with a MediaError', async () => {
    const engine = await startedEngine();
    fakeWebRtc.getUserMediaError = { name: 'NotReadableError', message: 'busy' };
    await expect(engine.setTunables(tunables({ autoGainControl: false }))).rejects.toMatchObject({
      code: 'capture-failed',
    });
    expect(fakeWebRtc.streams[0]!.released).toBe(false);
    engine.setMuted(true);
    expect(fakeWebRtc.streams[0]!.tracks[0]!.enabled).toBe(false);
  });
});

describe('stats', () => {
  it('maps the package report (a Map rebuilt from JSON) through mapStatsReport', async () => {
    const f = JSON.parse(
      readFileSync(join(__dirname, '__fixtures__', 'stats-connected.chromium.json'), 'utf8'),
    ) as { entries: Record<string, unknown>[] };
    fakeWebRtc.statsFor = () => new Map(f.entries.map((e) => [String(e.id), e]));
    const session = await (await startedEngine()).createSession();
    lastPc().setConnectionState('connected');
    const stats = await session.getStats();
    expect(stats.connectionState).toBe('connected');
    expect(stats.bytesSent).toBe(19571);
    expect(stats.bytesReceived).toBe(19571);
    expect(stats.codec).toBe('opus/48000/2');
    expect(stats.selectedPair).not.toBeNull();
    expect(stats.localCandidates.length).toBeGreaterThan(0);
  });

  it('getStats after close rejects with MediaError closed', async () => {
    const session = await (await startedEngine()).createSession();
    await session.close();
    await expect(session.getStats()).rejects.toMatchObject({ code: 'closed' });
  });
});

describe('cleanup', () => {
  it('close() closes the peer connection once, drops listeners and rejects further negotiation', async () => {
    const session = await (await startedEngine()).createSession();
    const pc = lastPc();
    const states: MediaConnectionState[] = [];
    const candidates: unknown[] = [];
    session.onState((s) => states.push(s));
    session.onLocalCandidate((c) => candidates.push(c));
    await session.close();
    await session.close();
    expect(pc.closed).toBe(true);
    pc.emit('connectionstatechange');
    pc.emitCandidate({ candidate: 'candidate:late', sdpMid: '0', sdpMLineIndex: 0 });
    expect(states).toEqual([]);
    expect(candidates).toEqual([]);
    await expect(session.createOffer()).rejects.toMatchObject({ code: 'closed' });
    await expect(session.acceptAnswer({ type: 'answer', sdp: 'x' })).rejects.toMatchObject({
      code: 'closed',
    });
    await expect(session.addRemoteCandidate(null)).resolves.toBeUndefined();
  });

  it('stop() closes every session and releases the microphone; start() again re-captures', async () => {
    const engine = await startedEngine();
    await engine.createSession();
    await engine.createSession({ sendLocalAudio: false });
    await engine.stop();
    expect(fakeWebRtc.peerConnections.every((pc) => pc.closed)).toBe(true);
    expect(fakeWebRtc.streams[0]!.released).toBe(true);
    expect(fakeWebRtc.streams[0]!.tracks[0]!.released).toBe(true);
    await expect(engine.createSession()).rejects.toMatchObject({ code: 'closed' });
    await engine.stop(); // idempotent
    await engine.start({ tunables: tunables(), startMuted: false });
    expect(fakeWebRtc.streams).toHaveLength(2);
    await engine.stop();
  });
});
