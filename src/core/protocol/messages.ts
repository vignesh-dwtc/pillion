/**
 * Wire message types for the signaling channel.
 * CONTRACT: owned by the lead. `core-protocol` implements framing, handshake and authentication
 * against these types; it may propose additions but must not change existing fields.
 *
 * Frame:   [u32 big-endian payload length][payload]            (max MAX_FRAME_BYTES)
 * Payload before auth completes:  UTF-8 JSON of a HandshakeMessage (each carries its own proof).
 * Payload after auth:             [32-byte HMAC tag][UTF-8 JSON of a SessionMessage]
 *   tag = HMAC-SHA256(directionKey, u64be(counter) || jsonBytes); `counter` is implicit (not sent),
 *   starts at 0 per direction per connection, so replay, reorder, drop and tamper all fail the MAC.
 * Keys:    HKDF-SHA256(secret, salt = nonceGuest || nonceHost, info = KDF_LABEL_SESSION) -> two direction keys.
 *
 * Handshake (mutual proof of the pairing secret before ANY session message is accepted):
 *   guest -> host   hello       { v, pairId, nonce }
 *   host  -> guest  hello-ack   { v, nonce, proof = HMAC(authKey, "host"  || pairId || nonceG || nonceH) }
 *   guest -> host   auth        { proof = HMAC(authKey, "guest" || pairId || nonceH || nonceG) }
 *   host  -> guest  ready       (first authenticated message)
 * authKey = HKDF-SHA256(secret, salt = empty, info = KDF_LABEL_AUTH). Comparisons are constant-time.
 * Either side may answer a plain `reject` instead; it is an unauthenticated hint, never trusted for state.
 *
 * Binding SDP to the pairing: every `sdp` message is MAC'd, so the DTLS fingerprint inside it is bound to
 * the pairing secret and a third party on the same network cannot splice in their own media endpoint.
 */

export type Base64Url = string;

export type RejectReason = 'unsupported-version' | 'unknown-pair' | 'bad-proof' | 'busy' | 'malformed';

// ---- Handshake (plain JSON frames) -------------------------------------------------------------------

export interface HelloMessage {
  type: 'hello';
  v: number;
  /** Non-secret pair id; the host rejects unknown ids before doing any crypto. */
  pairId: string;
  /** 16 random bytes, base64url. */
  nonce: Base64Url;
}

export interface HelloAckMessage {
  type: 'hello-ack';
  v: number;
  nonce: Base64Url;
  proof: Base64Url;
}

export interface AuthMessage {
  type: 'auth';
  proof: Base64Url;
}

export interface RejectMessage {
  type: 'reject';
  reason: RejectReason;
  /** Present for 'unsupported-version'. */
  supportedVersions?: number[];
}

export type HandshakeMessage = HelloMessage | HelloAckMessage | AuthMessage | RejectMessage;

// ---- Session messages (authenticated frames) ---------------------------------------------------------

/** First authenticated message, host -> guest. Carries no payload. */
export interface ReadyMessage {
  type: 'ready';
}

/** `generation` increments on every (re)negotiation so stale signaling can be discarded after a restart. */
export interface SdpMessage {
  type: 'sdp';
  generation: number;
  kind: 'offer' | 'answer';
  sdp: string;
}

export interface IceMessage {
  type: 'ice';
  generation: number;
  /** null = end-of-candidates. */
  candidate: { candidate: string; sdpMid: string | null; sdpMLineIndex: number | null } | null;
}

export interface PingMessage {
  type: 'ping';
  id: number;
  /** Sender's clock, ms; echoed by pong. Used for RTT and liveness only. */
  t: number;
}

export interface PongMessage {
  type: 'pong';
  id: number;
  t: number;
}

export type PeerInterruption = 'none' | 'phone-call' | 'headset-disconnected';

/** Sent on connect and on every change. Also how names are exchanged (the QR is one-way). */
export interface PeerStateMessage {
  type: 'peer-state';
  name: string;
  muted: boolean;
  headsetConnected: boolean;
  batteryPct: number | null;
  charging: boolean | null;
  interruption: PeerInterruption;
}

export type ByeReason = 'user-ended' | 'phone-call' | 'error';

export interface ByeMessage {
  type: 'bye';
  reason: ByeReason;
}

export type SessionMessage =
  ReadyMessage | SdpMessage | IceMessage | PingMessage | PongMessage | PeerStateMessage | ByeMessage;

export type WireMessage = HandshakeMessage | SessionMessage;
export type SessionMessageType = SessionMessage['type'];
