/**
 * Pairing data model.
 * CONTRACT: owned by the lead. Implementation (encode/decode/validate/generate) lives in
 * src/core/pairing and is owned by the `core-protocol` subagent.
 *
 * Pairing is one-time and offline. The phone that DISPLAYS the QR is the host (normally the rider's);
 * the phone that SCANS it is the guest. The QR is one-way, so the host does not learn the guest's name
 * at pairing time; names are exchanged in the authenticated `peer-state` message.
 */

/** Wi-Fi Direct group credentials, generated once at pairing and reused for every ride (M2). */
export interface WifiDirectCredentials {
  /** Must have the form `DIRECT-xy-<suffix>` (Android requirement), at most 32 bytes. */
  networkName: string;
  /** 8..63 printable ASCII characters. NEVER log or export. */
  passphrase: string;
}

/** What the QR / pairing string carries. */
export interface PairingPayload {
  /** Pairing payload format version (equals the protocol version it was created with). */
  version: number;
  /** 16 random bytes, base64url (22 chars). Non-secret: used to find/filter the partner on the link. */
  pairId: string;
  /** 32 random bytes. THE SECRET. Never log, export, or send over the wire. */
  secret: Uint8Array;
  /** Host's display name (1..24 chars after trimming). */
  hostName: string;
  wifiDirect: WifiDirectCredentials;
}

/** What each phone stores (Keystore-backed). A phone may hold several records; stage 1 uses one. */
export interface PairingRecord {
  pairId: string;
  /** Base64url of the 32-byte secret. NEVER log or export. */
  secret: string;
  /** The role this phone plays on this pairing: host showed the QR, guest scanned it. */
  role: 'host' | 'guest';
  /** Display name of the partner, when known (guest: from the QR; host: learned on first connection). */
  partnerName: string | null;
  wifiDirect: WifiDirectCredentials;
  createdAt: number;
}

/** Persistence port. Native implementation: Keystore-backed (expo-secure-store). Web: localStorage (dev only). */
export interface PairingRepository {
  list(): Promise<PairingRecord[]>;
  get(pairId: string): Promise<PairingRecord | null>;
  save(record: PairingRecord): Promise<void>;
  remove(pairId: string): Promise<void>;
}
