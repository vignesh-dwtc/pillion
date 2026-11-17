import type { IceCandidateInit } from '../../platform/media/MediaEngine';
import type { PeerInterruption, PeerStateMessage } from '../protocol/messages';
import type { PeerState } from './types';

/**
 * Defensive handling of messages from the partner. They arrive MAC-verified, so they come from a holder of the
 * pairing secret, but a buggy or newer partner build can still send values this build does not expect. Nothing
 * here may throw, and nothing may let an odd value reach the UI or the media engine unchecked.
 */

export const MAX_PEER_NAME_CHARS = 40;
export const MAX_SDP_CHARS = 60_000;
export const MAX_CANDIDATE_CHARS = 2_000;
export const FALLBACK_PEER_NAME = 'Partner';

/** C0/C1 controls, line/paragraph separators and bidirectional overrides/isolates (text-spoofing characters). */
function isUnsafeCodePoint(codePoint: number): boolean {
  return (
    codePoint <= 0x1f ||
    (codePoint >= 0x7f && codePoint <= 0x9f) ||
    codePoint === 0x2028 ||
    codePoint === 0x2029 ||
    (codePoint >= 0x202a && codePoint <= 0x202e) ||
    (codePoint >= 0x2066 && codePoint <= 0x2069)
  );
}

export function sanitizePeerName(value: unknown, fallback: string = FALLBACK_PEER_NAME): string {
  if (typeof value !== 'string') return fallback;
  // Work on code points, not UTF-16 units, so an emoji is never cut in half.
  const points = Array.from(value, (ch) => (isUnsafeCodePoint(ch.codePointAt(0) ?? 0) ? ' ' : ch));
  const cleaned = points.join('').replace(/\s+/g, ' ').trim();
  if (cleaned.length === 0) return fallback;
  const kept = Array.from(cleaned);
  return kept.length > MAX_PEER_NAME_CHARS ? kept.slice(0, MAX_PEER_NAME_CHARS).join('') : cleaned;
}

const INTERRUPTIONS: readonly PeerInterruption[] = ['none', 'phone-call', 'headset-disconnected'];

function sanitizeInterruption(value: unknown): PeerInterruption {
  return INTERRUPTIONS.find((candidate) => candidate === value) ?? 'none';
}

function sanitizeBattery(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  return Math.min(100, Math.max(0, Math.round(value)));
}

/** Coerces a `peer-state` message into a `PeerState`. Fields of the wrong type fall back to safe defaults. */
export function sanitizePeerState(message: PeerStateMessage, now: number): PeerState {
  return {
    name: sanitizePeerName(message.name),
    muted: message.muted === true,
    headsetConnected: message.headsetConnected === true,
    batteryPct: sanitizeBattery(message.batteryPct),
    charging: typeof message.charging === 'boolean' ? message.charging : null,
    interruption: sanitizeInterruption(message.interruption),
    updatedAt: now,
  };
}

export function isValidGeneration(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 1 && value <= 0x7fffffff;
}

export function isValidSdpText(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= MAX_SDP_CHARS;
}

/** Returns the candidate (or null for end-of-candidates) when well-formed, `undefined` when malformed. */
export function parseIceCandidate(value: unknown): IceCandidateInit | null | undefined {
  if (value === null) return null;
  if (typeof value !== 'object') return undefined;
  const candidate = value as { candidate?: unknown; sdpMid?: unknown; sdpMLineIndex?: unknown };
  if (typeof candidate.candidate !== 'string' || candidate.candidate.length > MAX_CANDIDATE_CHARS)
    return undefined;
  const sdpMid = candidate.sdpMid === null || typeof candidate.sdpMid === 'string' ? candidate.sdpMid : null;
  const index = candidate.sdpMLineIndex;
  const sdpMLineIndex = typeof index === 'number' && Number.isSafeInteger(index) && index >= 0 ? index : null;
  return { candidate: candidate.candidate, sdpMid, sdpMLineIndex };
}
