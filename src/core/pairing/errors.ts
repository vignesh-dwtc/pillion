/**
 * Typed pairing failures. Messages are static text: they never contain the pairing secret, the Wi-Fi passphrase,
 * or any other value taken from the input, so an error can be logged or shown without redaction.
 */
export type PairingErrorCode =
  /** The text does not start with the product's pairing prefix (a different app, or a typo). */
  | 'bad-prefix'
  /** Prefix present but the `<version>:` part is missing or malformed. */
  | 'bad-format'
  /** A well-formed version this build does not understand (a code from a newer or older app). */
  | 'unsupported-version'
  /** The text after `<version>:` is not canonical base64url. */
  | 'bad-encoding'
  /** The text is longer than any valid pairing string can be. */
  | 'too-long'
  /** The binary payload ends before all fields were read. */
  | 'truncated'
  /** Bytes remain after the last field. */
  | 'trailing-data'
  | 'bad-pair-id'
  | 'bad-secret'
  | 'bad-host-name'
  | 'bad-network-name'
  | 'bad-passphrase'
  /** The injected random source returned the wrong amount or obviously non-random data. */
  | 'rng-failure'
  /** A stored PairingRecord (or other structured input) has the wrong shape. */
  | 'bad-record';

export class PairingError extends Error {
  readonly code: PairingErrorCode;

  constructor(code: PairingErrorCode, message?: string) {
    super(message ?? code);
    // Keep `instanceof PairingError` working even when classes are down-levelled.
    Object.setPrototypeOf(this, new.target.prototype);
    this.name = 'PairingError';
    this.code = code;
  }
}
