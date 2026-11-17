/** Public surface of src/core/pairing: the frozen types plus their implementation. */
export * from './types';
export { PairingError } from './errors';
export type { PairingErrorCode } from './errors';
export { PAIRING_PREFIX } from './config';
export {
  HOST_NAME_MAX_LENGTH,
  PAIRING_VERSION,
  validateHostName,
  validateNetworkName,
  validatePairId,
  validatePairingPayload,
  validatePairingRecord,
  validatePassphrase,
  validateSecret,
  validateWifiDirect,
} from './validate';
export { generatePairing } from './generate';
export { MAX_PAIRING_STRING_LENGTH, decodePairingString, encodePairingString } from './payload';
export { payloadFromRecord, recordFromPayload } from './record';
export { MemoryPairingRepository, createMemoryPairingRepository } from './memoryRepository';
