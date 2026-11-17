import { base64urlDecode, base64urlEncode } from '../protocol/base64url';
import { concatBytes, copyBytes } from '../protocol/bytes';
import { PAIR_ID_BYTES, SECRET_BYTES } from '../protocol/constants';
import { utf8Decode, utf8Encode } from '../protocol/utf8';
import { PAIRING_PREFIX } from './config';
import { PairingError } from './errors';
import type { PairingPayload } from './types';
import { PAIRING_VERSION, validatePairingPayload } from './validate';

/**
 * Pairing string: `<prefix><version>:<base64url(binary payload)>`, for example `pillion1:AbC...`.
 *
 * Binary payload (all lengths are one byte):
 *   pairId (16) | secret (32) | nameLen | host name (UTF-8) | x | y | suffixLen | suffix (7-bit packed) |
 *   passLen | passphrase (7-bit packed)
 * `DIRECT-` and the `-` after `xy` are implied, and the printable-ASCII fields are packed at 7 bits per character
 * (padding bits must be zero), which keeps the worst case under QR version 12 at error correction M.
 * Decoding is strict and canonical: one text per payload, no trailing data, every field re-validated.
 */

/** Longest legal pairing string (measured worst case is below 300); anything longer is rejected before decoding. */
export const MAX_PAIRING_STRING_LENGTH = 400;

/** Packs 7-bit characters, most significant bit first, zero padding. */
function pack7(text: string): Uint8Array {
  const out = new Uint8Array(Math.ceil((text.length * 7) / 8));
  let bitPos = 0;
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i) & 0x7f;
    for (let b = 6; b >= 0; b--) {
      if ((code >> b) & 1) out[bitPos >> 3] = (out[bitPos >> 3] ?? 0) | (0x80 >> (bitPos & 7));
      bitPos += 1;
    }
  }
  return out;
}

/** Inverse of pack7 for `count` characters; null when the padding bits are not zero. */
function unpack7(bytes: Uint8Array, count: number): string | null {
  let out = '';
  let bitPos = 0;
  for (let i = 0; i < count; i++) {
    let code = 0;
    for (let b = 0; b < 7; b++) {
      code = (code << 1) | (((bytes[bitPos >> 3] ?? 0) >> (7 - (bitPos & 7))) & 1);
      bitPos += 1;
    }
    out += String.fromCharCode(code);
  }
  for (; bitPos < bytes.length * 8; bitPos++) {
    if (((bytes[bitPos >> 3] ?? 0) >> (7 - (bitPos & 7))) & 1) return null;
  }
  return out;
}

const packedLength = (count: number): number => Math.ceil((count * 7) / 8);

/** Validates, then encodes. Throws PairingError for an invalid payload. */
export function encodePairingString(payload: PairingPayload): string {
  validatePairingPayload(payload);
  const pairId = base64urlDecode(payload.pairId) as Uint8Array;
  const name = utf8Encode(payload.hostName);
  const { networkName, passphrase } = payload.wifiDirect;
  const suffix = networkName.slice(10);
  const binary = concatBytes(
    pairId,
    payload.secret,
    Uint8Array.of(name.length),
    name,
    Uint8Array.of(networkName.charCodeAt(7), networkName.charCodeAt(8), suffix.length),
    pack7(suffix),
    Uint8Array.of(passphrase.length),
    pack7(passphrase),
  );
  return `${PAIRING_PREFIX}${payload.version}:${base64urlEncode(binary)}`;
}

class Reader {
  private offset = 0;
  constructor(private readonly bytes: Uint8Array) {}
  take(length: number): Uint8Array {
    if (this.offset + length > this.bytes.length)
      throw new PairingError('truncated', 'pairing payload is truncated');
    const out = this.bytes.slice(this.offset, this.offset + length);
    this.offset += length;
    return out;
  }
  byte(): number {
    return this.take(1)[0] as number;
  }
  get remaining(): number {
    return this.bytes.length - this.offset;
  }
}

/** Parses and strictly validates a pairing string. Throws PairingError; never echoes input in the message. */
export function decodePairingString(text: string): PairingPayload {
  if (typeof text !== 'string') throw new PairingError('bad-format', 'pairing text must be a string');
  if (text.length > MAX_PAIRING_STRING_LENGTH) throw new PairingError('too-long', 'pairing text is too long');
  if (!text.startsWith(PAIRING_PREFIX))
    throw new PairingError('bad-prefix', 'not a pairing code for this app');
  const rest = text.slice(PAIRING_PREFIX.length);
  const colon = rest.indexOf(':');
  const versionText = colon < 0 ? '' : rest.slice(0, colon);
  if (!/^[1-9][0-9]{0,2}$/.test(versionText))
    throw new PairingError('bad-format', 'pairing version is malformed');
  const version = Number(versionText);
  if (version !== PAIRING_VERSION)
    throw new PairingError('unsupported-version', 'pairing version is not supported');
  const binary = base64urlDecode(rest.slice(colon + 1));
  if (binary === null) throw new PairingError('bad-encoding', 'pairing data is not canonical base64url');

  const reader = new Reader(binary);
  const pairId = base64urlEncode(reader.take(PAIR_ID_BYTES));
  const secret = copyBytes(reader.take(SECRET_BYTES));
  const hostName = utf8Decode(reader.take(reader.byte()));
  if (hostName === null) throw new PairingError('bad-host-name', 'host name is not valid UTF-8');
  const x = reader.byte();
  const y = reader.byte();
  const suffixLength = reader.byte();
  const suffix = unpack7(reader.take(packedLength(suffixLength)), suffixLength);
  if (suffix === null) throw new PairingError('bad-network-name', 'network name padding is not canonical');
  const passLength = reader.byte();
  const passphrase = unpack7(reader.take(packedLength(passLength)), passLength);
  if (passphrase === null) throw new PairingError('bad-passphrase', 'passphrase padding is not canonical');
  if (reader.remaining !== 0) throw new PairingError('trailing-data', 'pairing payload has trailing data');

  const payload: PairingPayload = {
    version,
    pairId,
    secret,
    hostName,
    wifiDirect: {
      networkName: `DIRECT-${String.fromCharCode(x, y)}-${suffix}`,
      passphrase,
    },
  };
  validatePairingPayload(payload);
  return payload;
}
