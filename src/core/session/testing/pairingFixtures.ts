import { encodeBase64Url } from '../base64url';
import type { PairingRecord } from '../../pairing/types';

/**
 * Test pairing records. The ids are canonical base64url of 16 / 32 bytes (what the real handshake requires).
 * `secretByte` seeds the secret: two records with different values do NOT trust each other (auth-failed tests).
 */

export const TEST_PASSPHRASE = 'test-passphrase-do-not-log';

export function makeTestPairing(
  role: 'host' | 'guest',
  options: { secretByte?: number; pairIdByte?: number } = {},
): PairingRecord {
  const secretByte = options.secretByte ?? 0x42;
  const pairIdByte = options.pairIdByte ?? 0x10;
  const pairId = new Uint8Array(16).map((_, i) => (pairIdByte + i) & 0xff);
  const secret = new Uint8Array(32).map((_, i) => (secretByte * 7 + i * 13 + 1) & 0xff);
  return {
    pairId: encodeBase64Url(pairId),
    secret: encodeBase64Url(secret),
    role,
    partnerName: null,
    wifiDirect: { networkName: 'DIRECT-xy-test', passphrase: TEST_PASSPHRASE },
    createdAt: 0,
  };
}
