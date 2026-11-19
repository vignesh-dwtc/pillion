import type { PeerStateMessage } from '../protocol/messages';
import {
  FALLBACK_PEER_NAME,
  MAX_PEER_NAME_CHARS,
  isValidGeneration,
  isValidSdpText,
  parseIceCandidate,
  sanitizePeerName,
  sanitizePeerState,
} from './inbound';

const base: PeerStateMessage = {
  type: 'peer-state',
  name: 'Alex',
  muted: true,
  headsetConnected: true,
  batteryPct: 63.4,
  charging: true,
  interruption: 'phone-call',
};

describe('sanitizePeerName', () => {
  it('keeps an ordinary name, trims and collapses whitespace', () => {
    expect(sanitizePeerName('  Alex   Rider ')).toBe('Alex Rider');
    expect(sanitizePeerName('Zoë 😀')).toBe('Zoë 😀');
  });

  it('replaces control characters, line separators and bidi overrides', () => {
    expect(sanitizePeerName('Al\u0000ex\n\r\tR‮evil⁦x')).toBe('Al ex R evil x');
  });

  it('falls back for non-strings and for names that are empty after cleaning', () => {
    expect(sanitizePeerName(undefined)).toBe(FALLBACK_PEER_NAME);
    expect(sanitizePeerName(42)).toBe(FALLBACK_PEER_NAME);
    expect(sanitizePeerName('   ‮  ')).toBe(FALLBACK_PEER_NAME);
    expect(sanitizePeerName('', 'Phone')).toBe('Phone');
  });

  it('truncates by code point, never cutting an emoji in half', () => {
    const long = '😀'.repeat(MAX_PEER_NAME_CHARS + 10);
    const cut = sanitizePeerName(long);
    expect(Array.from(cut)).toHaveLength(MAX_PEER_NAME_CHARS);
    expect(cut).toBe('😀'.repeat(MAX_PEER_NAME_CHARS));
  });
});

describe('sanitizePeerState', () => {
  it('maps a well-formed message and stamps the arrival time', () => {
    expect(sanitizePeerState(base, 1234)).toEqual({
      name: 'Alex',
      muted: true,
      headsetConnected: true,
      batteryPct: 63,
      charging: true,
      interruption: 'phone-call',
      updatedAt: 1234,
    });
  });

  it('coerces values of the wrong type to safe defaults instead of throwing', () => {
    const hostile = {
      type: 'peer-state',
      name: { toString: 'x' },
      muted: 'yes',
      headsetConnected: 1,
      batteryPct: 'full',
      charging: 'sometimes',
      interruption: 'exploding',
    } as unknown as PeerStateMessage;
    expect(sanitizePeerState(hostile, 1)).toEqual({
      name: FALLBACK_PEER_NAME,
      muted: false,
      headsetConnected: false,
      batteryPct: null,
      charging: null,
      interruption: 'none',
      updatedAt: 1,
    });
  });

  it('clamps battery to 0..100 and rejects non-finite numbers', () => {
    expect(sanitizePeerState({ ...base, batteryPct: 250 }, 0).batteryPct).toBe(100);
    expect(sanitizePeerState({ ...base, batteryPct: -9 }, 0).batteryPct).toBe(0);
    expect(sanitizePeerState({ ...base, batteryPct: Number.NaN }, 0).batteryPct).toBeNull();
    expect(sanitizePeerState({ ...base, batteryPct: Number.POSITIVE_INFINITY }, 0).batteryPct).toBeNull();
    expect(sanitizePeerState({ ...base, batteryPct: null }, 0).batteryPct).toBeNull();
  });
});

describe('signaling field validation', () => {
  it('accepts only positive safe-integer generations', () => {
    for (const ok of [1, 2, 1000, 0x7fffffff]) expect(isValidGeneration(ok)).toBe(true);
    for (const bad of [0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, 0x80000000, '1', null, undefined]) {
      expect(isValidGeneration(bad)).toBe(false);
    }
  });

  it('accepts non-empty SDP text up to the limit only', () => {
    expect(isValidSdpText('v=0')).toBe(true);
    expect(isValidSdpText('')).toBe(false);
    expect(isValidSdpText('x'.repeat(60_001))).toBe(false);
    expect(isValidSdpText(5)).toBe(false);
  });

  it('parses a candidate, the end-of-candidates null, and rejects malformed ones', () => {
    expect(parseIceCandidate(null)).toBeNull();
    expect(parseIceCandidate({ candidate: 'candidate:1', sdpMid: '0', sdpMLineIndex: 0 })).toEqual({
      candidate: 'candidate:1',
      sdpMid: '0',
      sdpMLineIndex: 0,
    });
    expect(parseIceCandidate({ candidate: 'c', sdpMid: 7, sdpMLineIndex: -3 })).toEqual({
      candidate: 'c',
      sdpMid: null,
      sdpMLineIndex: null,
    });
    expect(parseIceCandidate({ candidate: 5 })).toBeUndefined();
    expect(parseIceCandidate('candidate')).toBeUndefined();
    expect(
      parseIceCandidate({ candidate: 'x'.repeat(3000), sdpMid: null, sdpMLineIndex: null }),
    ).toBeUndefined();
    expect(parseIceCandidate(undefined)).toBeUndefined();
  });
});
