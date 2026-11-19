import { base64urlDecode, base64urlEncode } from '../protocol/base64url';
import { copyBytes } from '../protocol/bytes';
import type { PairingPayload, PairingRecord } from './types';
import { PAIRING_VERSION, validatePairingPayload, validatePairingRecord } from './validate';

/**
 * What each phone stores after pairing. The host showed the QR and does not yet know the guest's name
 * (partnerName null); the guest scanned it and knows the host's name.
 */
export function recordFromPayload(
  payload: PairingPayload,
  role: 'host' | 'guest',
  now: number,
): PairingRecord {
  validatePairingPayload(payload);
  return validatePairingRecord({
    pairId: payload.pairId,
    secret: base64urlEncode(payload.secret),
    role,
    partnerName: role === 'guest' ? payload.hostName : null,
    wifiDirect: { ...payload.wifiDirect },
    createdAt: now,
  });
}

/** Rebuilds the payload (to show the QR again) from a host record. `hostName` is this phone's own name. */
export function payloadFromRecord(record: PairingRecord, hostName: string): PairingPayload {
  const valid = validatePairingRecord(record);
  const payload: PairingPayload = {
    version: PAIRING_VERSION,
    pairId: valid.pairId,
    secret: copyBytes(base64urlDecode(valid.secret) as Uint8Array),
    hostName,
    wifiDirect: { ...valid.wifiDirect },
  };
  validatePairingPayload(payload);
  return payload;
}
