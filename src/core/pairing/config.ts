import identity from '../../../config/identity.json';

/**
 * The only two values this module reads from config/identity.json. Product names live there and nowhere else
 * (CLAUDE.md); the pairing prefix is part of what the QR code looks like, so renaming the product changes it.
 * The relative JSON import resolves under Jest, Metro and tsc alike.
 */

/** Start of every pairing string: `<prefix><version>:<base64url payload>`. */
export const PAIRING_PREFIX: string = identity.pairingPrefix;

/** Start of every generated Wi-Fi Direct network name, `DIRECT-xy-` with x and y alphanumeric. */
export const WIFI_DIRECT_NAME_PREFIX: string = identity.wifiDirectNamePrefix;
