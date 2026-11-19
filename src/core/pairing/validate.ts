import { base64urlDecode } from '../protocol/base64url';
import { isBytes } from '../protocol/bytes';
import { PAIR_ID_BYTES, PROTOCOL_VERSION, SECRET_BYTES } from '../protocol/constants';
import { MAX_PEER_NAME_LENGTH } from '../protocol/limits';
import { PairingError } from './errors';
import type { PairingPayload, PairingRecord, WifiDirectCredentials } from './types';

/**
 * Strict validators for everything a pairing carries. Each throws PairingError with a static message (never the
 * offending value). They are used on every path: when generating, before encoding, after decoding, and when a
 * record is stored or loaded, so no module has to trust another one.
 */

/** Pairing payload format version; it equals the protocol version the payload was created with. */
export const PAIRING_VERSION = PROTOCOL_VERSION;

/** Host name length limit in UTF-16 code units (`String.length`, which is also what a TextInput's maxLength counts). */
export const HOST_NAME_MAX_LENGTH = 24;

/** One UTF-16 code unit is at most 3 UTF-8 bytes (a surrogate PAIR is 4 bytes for 2 units), so this is the byte bound. */
export const HOST_NAME_MAX_UTF8_BYTES = 3 * HOST_NAME_MAX_LENGTH;

export const NETWORK_NAME_MAX_BYTES = 32;
export const PASSPHRASE_MIN_LENGTH = 8;
export const PASSPHRASE_MAX_LENGTH = 63;

const WIFI_DIRECT_PREFIX = 'DIRECT-';

function isAlphanumeric(code: number): boolean {
  return (code >= 0x30 && code <= 0x39) || (code >= 0x41 && code <= 0x5a) || (code >= 0x61 && code <= 0x7a);
}

/** UTF-16 well-formedness: every surrogate is half of a proper pair. */
function isWellFormed(text: string): boolean {
  for (let i = 0; i < text.length; i++) {
    const unit = text.charCodeAt(i);
    if (unit >= 0xd800 && unit <= 0xdbff) {
      const next = text.charCodeAt(i + 1);
      if (!(next >= 0xdc00 && next <= 0xdfff)) return false;
      i += 1;
    } else if (unit >= 0xdc00 && unit <= 0xdfff) {
      return false;
    }
  }
  return true;
}

/** Control characters, line/paragraph separators, bidi overrides and isolates, and the two noncharacters. */
function isForbiddenInName(unit: number): boolean {
  return (
    unit < 0x20 ||
    (unit >= 0x7f && unit <= 0x9f) ||
    unit === 0x2028 ||
    unit === 0x2029 ||
    (unit >= 0x202a && unit <= 0x202e) ||
    (unit >= 0x2066 && unit <= 0x2069) ||
    unit === 0xfffe ||
    unit === 0xffff
  );
}

/**
 * The host's display name: 1..24 UTF-16 code units, already trimmed (strict: `generatePairing` trims user input
 * first), well-formed Unicode, no control characters. Returns the same string.
 */
export function validateHostName(name: unknown): string {
  if (typeof name !== 'string') throw new PairingError('bad-host-name', 'host name must be a string');
  if (name.length === 0) throw new PairingError('bad-host-name', 'host name must not be empty');
  if (name !== name.trim()) {
    throw new PairingError('bad-host-name', 'host name must not start or end with whitespace');
  }
  if (name.length > HOST_NAME_MAX_LENGTH) {
    throw new PairingError('bad-host-name', `host name must be at most ${HOST_NAME_MAX_LENGTH} characters`);
  }
  if (!isWellFormed(name)) throw new PairingError('bad-host-name', 'host name is not well-formed Unicode');
  for (let i = 0; i < name.length; i++) {
    if (isForbiddenInName(name.charCodeAt(i))) {
      throw new PairingError('bad-host-name', 'host name contains a control or formatting character');
    }
  }
  return name;
}

/** `DIRECT-xy-<suffix>`: x and y alphanumeric, suffix 1+ printable ASCII (no space), 32 bytes at most (all ASCII). */
export function validateNetworkName(name: unknown): string {
  const fail = (): never => {
    throw new PairingError(
      'bad-network-name',
      'network name must look like DIRECT-xy-<suffix>, at most 32 bytes',
    );
  };
  if (typeof name !== 'string') return fail();
  if (name.length < WIFI_DIRECT_PREFIX.length + 4 || name.length > NETWORK_NAME_MAX_BYTES) return fail();
  if (!name.startsWith(WIFI_DIRECT_PREFIX)) return fail();
  const x = name.charCodeAt(7);
  const y = name.charCodeAt(8);
  if (!isAlphanumeric(x) || !isAlphanumeric(y) || name.charAt(9) !== '-') return fail();
  for (let i = 10; i < name.length; i++) {
    const code = name.charCodeAt(i);
    if (code < 0x21 || code > 0x7e) return fail();
  }
  return name;
}

/** 8..63 printable ASCII characters (0x20..0x7E): the WPA2-PSK passphrase rule. */
export function validatePassphrase(passphrase: unknown): string {
  const fail = (): never => {
    throw new PairingError('bad-passphrase', 'passphrase must be 8 to 63 printable ASCII characters');
  };
  if (typeof passphrase !== 'string') return fail();
  if (passphrase.length < PASSPHRASE_MIN_LENGTH || passphrase.length > PASSPHRASE_MAX_LENGTH) return fail();
  for (let i = 0; i < passphrase.length; i++) {
    const code = passphrase.charCodeAt(i);
    if (code < 0x20 || code > 0x7e) return fail();
  }
  return passphrase;
}

export function validateWifiDirect(value: unknown): WifiDirectCredentials {
  if (typeof value !== 'object' || value === null) {
    throw new PairingError('bad-network-name', 'Wi-Fi Direct credentials are missing');
  }
  const { networkName, passphrase } = value as Partial<WifiDirectCredentials>;
  return { networkName: validateNetworkName(networkName), passphrase: validatePassphrase(passphrase) };
}

/** Canonical base64url of exactly 16 bytes (22 characters). Returns the same string. */
export function validatePairId(pairId: unknown): string {
  const decoded = typeof pairId === 'string' ? base64urlDecode(pairId) : null;
  if (decoded === null || decoded.length !== PAIR_ID_BYTES) {
    throw new PairingError('bad-pair-id', 'pair id must be canonical base64url of 16 bytes');
  }
  return pairId as string;
}

/** Exactly 32 bytes. Returns the same array. */
export function validateSecret(secret: unknown): Uint8Array {
  if (!isBytes(secret) || secret.length !== SECRET_BYTES) {
    throw new PairingError('bad-secret', `secret must be ${SECRET_BYTES} bytes`);
  }
  return secret;
}

/** Strict check of a payload about to be encoded (or just decoded). Does not trim or fix anything. */
export function validatePairingPayload(payload: PairingPayload): void {
  if (typeof payload !== 'object' || payload === null) {
    throw new PairingError('bad-record', 'pairing payload must be an object');
  }
  if (payload.version !== PAIRING_VERSION) {
    throw new PairingError('unsupported-version', `pairing payload version must be ${PAIRING_VERSION}`);
  }
  validatePairId(payload.pairId);
  validateSecret(payload.secret);
  validateHostName(payload.hostName);
  validateWifiDirect(payload.wifiDirect);
}

/**
 * Validates an unknown value (for example JSON read back from storage) as a PairingRecord and returns a fresh,
 * normalised copy: unknown properties are dropped, nothing is shared with the input.
 */
export function validatePairingRecord(value: unknown): PairingRecord {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new PairingError('bad-record', 'pairing record must be an object');
  }
  const record = value as Partial<Record<keyof PairingRecord, unknown>>;
  const pairId = validatePairId(record.pairId);
  const secret = record.secret;
  const secretBytes = typeof secret === 'string' ? base64urlDecode(secret) : null;
  if (secretBytes === null || secretBytes.length !== SECRET_BYTES) {
    throw new PairingError('bad-secret', 'stored secret must be canonical base64url of 32 bytes');
  }
  if (record.role !== 'host' && record.role !== 'guest') {
    throw new PairingError('bad-record', 'pairing record role must be "host" or "guest"');
  }
  const partnerName = record.partnerName;
  if (
    partnerName !== null &&
    (typeof partnerName !== 'string' || partnerName.length > MAX_PEER_NAME_LENGTH)
  ) {
    throw new PairingError('bad-record', 'partner name must be a short string or null');
  }
  const createdAt = record.createdAt;
  if (typeof createdAt !== 'number' || !Number.isFinite(createdAt) || createdAt < 0) {
    throw new PairingError('bad-record', 'createdAt must be a non-negative number');
  }
  return {
    pairId,
    secret: secret as string,
    role: record.role,
    partnerName,
    wifiDirect: validateWifiDirect(record.wifiDirect),
    createdAt,
  };
}
