import { base64urlDecode } from './base64url';
import { MAX_FRAME_BYTES, NONCE_BYTES, MAC_BYTES, PAIR_ID_BYTES } from './constants';
import { MAX_PEER_NAME_LENGTH, MAX_SHORT_STRING_LENGTH, MAX_SUPPORTED_VERSIONS_LISTED } from './limits';
import type { ByeReason, HandshakeMessage, PeerInterruption, RejectReason, SessionMessage } from './messages';
import { ProtocolError } from './secureChannel';
import { utf8Decode, utf8Encode } from './utf8';

/**
 * JSON <-> message codec with STRICT validation. Every field is type-checked, strings and arrays are bounded,
 * unknown message types are rejected, and the result is a fresh object built from validated fields only, so unknown
 * extra properties from the wire are dropped (nothing is spread or merged).
 *
 * Error messages name the offending field but never echo wire content, and no secret ever reaches this module.
 */

type JsonObject = Record<string, unknown>;

function malformed(detail: string): ProtocolError {
  return new ProtocolError('malformed-frame', `malformed message: ${detail}`);
}

function badField(field: string): ProtocolError {
  return malformed(`invalid field "${field}"`);
}

function isJsonObject(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Own properties only: `{}.constructor` and friends must never be mistaken for message fields. */
function read(object: JsonObject, key: string): unknown {
  return Object.prototype.hasOwnProperty.call(object, key) ? object[key] : undefined;
}

function readString(object: JsonObject, key: string, maxLength: number): string {
  const value = read(object, key);
  if (typeof value !== 'string' || value.length > maxLength) throw badField(key);
  return value;
}

/** Non-negative safe integer. */
function readCount(object: JsonObject, key: string): number {
  const value = read(object, key);
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) throw badField(key);
  return value;
}

function readFiniteNumber(object: JsonObject, key: string): number {
  const value = read(object, key);
  if (typeof value !== 'number' || !Number.isFinite(value)) throw badField(key);
  return value;
}

function readBoolean(object: JsonObject, key: string): boolean {
  const value = read(object, key);
  if (typeof value !== 'boolean') throw badField(key);
  return value;
}

function readOneOf<T extends string>(object: JsonObject, key: string, allowed: readonly T[]): T {
  const value = read(object, key);
  if (typeof value === 'string') {
    for (const candidate of allowed) if (candidate === value) return candidate;
  }
  throw badField(key);
}

/** Canonical base64url that decodes to exactly `length` bytes. */
function readBytes(object: JsonObject, key: string, length: number): Uint8Array {
  const value = read(object, key);
  const decoded = typeof value === 'string' ? base64urlDecode(value) : null;
  if (decoded === null || decoded.length !== length) throw badField(key);
  return decoded;
}

/** `null` and absent both mean "no value" (JSON.stringify drops `undefined`). */
function readNullableString(object: JsonObject, key: string, maxLength: number): string | null {
  const value = read(object, key);
  if (value === null || value === undefined) return null;
  if (typeof value !== 'string' || value.length > maxLength) throw badField(key);
  return value;
}

function readNullableCount(object: JsonObject, key: string): number | null {
  const value = read(object, key);
  if (value === null || value === undefined) return null;
  return readCount(object, key);
}

function readNullableFiniteNumber(object: JsonObject, key: string): number | null {
  const value = read(object, key);
  if (value === null || value === undefined) return null;
  return readFiniteNumber(object, key);
}

function readNullableBoolean(object: JsonObject, key: string): boolean | null {
  const value = read(object, key);
  if (value === null || value === undefined) return null;
  return readBoolean(object, key);
}

function parseJsonObject(bytes: Uint8Array): JsonObject {
  const text = utf8Decode(bytes);
  if (text === null) throw malformed('payload is not valid UTF-8');
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    throw malformed('payload is not valid JSON');
  }
  if (!isJsonObject(value)) throw malformed('payload is not a JSON object');
  return value;
}

// ---- Handshake ------------------------------------------------------------------------------------------

const REJECT_REASONS: readonly RejectReason[] = [
  'unsupported-version',
  'unknown-pair',
  'bad-proof',
  'busy',
  'malformed',
];

/** Handshake messages with their base64url fields already decoded to bytes. */
export interface ParsedHello {
  type: 'hello';
  v: number;
  /** Canonical base64url text (22 chars) of 16 bytes. Compared as a string, it is not secret. */
  pairId: string;
  nonce: Uint8Array;
}

export interface ParsedHelloAck {
  type: 'hello-ack';
  v: number;
  nonce: Uint8Array;
  proof: Uint8Array;
}

export interface ParsedAuth {
  type: 'auth';
  proof: Uint8Array;
}

export interface ParsedReject {
  type: 'reject';
  reason: RejectReason;
  supportedVersions: number[] | undefined;
}

export type ParsedHandshakeMessage = ParsedHello | ParsedHelloAck | ParsedAuth | ParsedReject;

/** Largest handshake proof field: HMAC-SHA256 output. */
const PROOF_BYTES = MAC_BYTES;

/** Parses an unauthenticated handshake frame payload. Throws ProtocolError('malformed-frame') on any defect. */
export function parseHandshakeMessage(bytes: Uint8Array): ParsedHandshakeMessage {
  const object = parseJsonObject(bytes);
  const type = read(object, 'type');
  switch (type) {
    case 'hello':
      return {
        type: 'hello',
        v: readCount(object, 'v'),
        pairId: readPairId(object),
        nonce: readBytes(object, 'nonce', NONCE_BYTES),
      };
    case 'hello-ack':
      return {
        type: 'hello-ack',
        v: readCount(object, 'v'),
        nonce: readBytes(object, 'nonce', NONCE_BYTES),
        proof: readBytes(object, 'proof', PROOF_BYTES),
      };
    case 'auth':
      return { type: 'auth', proof: readBytes(object, 'proof', PROOF_BYTES) };
    case 'reject':
      return {
        type: 'reject',
        reason: readOneOf(object, 'reason', REJECT_REASONS),
        supportedVersions: readSupportedVersions(object),
      };
    default:
      throw malformed('unknown handshake message type');
  }
}

function readPairId(object: JsonObject): string {
  readBytes(object, 'pairId', PAIR_ID_BYTES); // validates: canonical base64url of exactly 16 bytes
  return read(object, 'pairId') as string;
}

function readSupportedVersions(object: JsonObject): number[] | undefined {
  const value = read(object, 'supportedVersions');
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.length > MAX_SUPPORTED_VERSIONS_LISTED)
    throw badField('supportedVersions');
  const versions: number[] = [];
  for (const entry of value as unknown[]) {
    if (typeof entry !== 'number' || !Number.isSafeInteger(entry) || entry < 0) {
      throw badField('supportedVersions');
    }
    versions.push(entry);
  }
  return versions;
}

/** Serialises a handshake message exactly as given (key order is the caller's literal order). */
export function encodeHandshakeMessage(message: HandshakeMessage): Uint8Array {
  return utf8Encode(JSON.stringify(message));
}

// ---- Session messages -----------------------------------------------------------------------------------

const PEER_INTERRUPTIONS: readonly PeerInterruption[] = ['none', 'phone-call', 'headset-disconnected'];
const BYE_REASONS: readonly ByeReason[] = ['user-ended', 'phone-call', 'error'];
const SDP_KINDS = ['offer', 'answer'] as const;

/**
 * Parses an authenticated session message body. Throws ProtocolError('malformed-frame') on any defect, including
 * a message type this protocol version does not define.
 */
export function parseSessionMessage(bytes: Uint8Array): SessionMessage {
  const object = parseJsonObject(bytes);
  const type = read(object, 'type');
  switch (type) {
    case 'ready':
      return { type: 'ready' };
    case 'sdp':
      return {
        type: 'sdp',
        generation: readCount(object, 'generation'),
        kind: readOneOf(object, 'kind', SDP_KINDS),
        sdp: readString(object, 'sdp', MAX_FRAME_BYTES),
      };
    case 'ice': {
      const generation = readCount(object, 'generation');
      const candidate = read(object, 'candidate');
      if (candidate === null) return { type: 'ice', generation, candidate: null };
      if (!isJsonObject(candidate)) throw badField('candidate');
      return {
        type: 'ice',
        generation,
        candidate: {
          candidate: readString(candidate, 'candidate', MAX_FRAME_BYTES),
          sdpMid: readNullableString(candidate, 'sdpMid', MAX_SHORT_STRING_LENGTH),
          sdpMLineIndex: readNullableCount(candidate, 'sdpMLineIndex'),
        },
      };
    }
    case 'ping':
      return { type: 'ping', id: readCount(object, 'id'), t: readFiniteNumber(object, 't') };
    case 'pong':
      return { type: 'pong', id: readCount(object, 'id'), t: readFiniteNumber(object, 't') };
    case 'peer-state':
      return {
        type: 'peer-state',
        name: readString(object, 'name', MAX_PEER_NAME_LENGTH),
        muted: readBoolean(object, 'muted'),
        headsetConnected: readBoolean(object, 'headsetConnected'),
        batteryPct: readNullableFiniteNumber(object, 'batteryPct'),
        charging: readNullableBoolean(object, 'charging'),
        interruption: readOneOf(object, 'interruption', PEER_INTERRUPTIONS),
      };
    case 'bye':
      return { type: 'bye', reason: readOneOf(object, 'reason', BYE_REASONS) };
    default:
      throw malformed('unknown session message type');
  }
}

/**
 * Serialises a session message and proves the receiver's parser will accept those exact bytes (the message is
 * parsed back with the same validator). A caller bug therefore fails loudly here instead of making the partner
 * close the channel. `NaN` and `undefined` fields are normalised by JSON itself (to null / absent) before validation.
 */
export function encodeSessionMessage(message: SessionMessage): Uint8Array {
  let json: string | undefined;
  try {
    json = JSON.stringify(message);
  } catch {
    throw malformed('message is not serialisable');
  }
  if (typeof json !== 'string') throw malformed('message is not serialisable');
  const bytes = utf8Encode(json);
  parseSessionMessage(bytes);
  return bytes;
}
