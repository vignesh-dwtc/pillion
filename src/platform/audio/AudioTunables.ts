/**
 * Every audio tunable lives in this one object so a hidden debug screen can change it at runtime
 * (wind noise can only be tuned on the road). CONTRACT for the type: owned by the lead.
 * The `media` subagent owns defaults, validation and how each field is applied (constraints, SDP fmtp,
 * RTCRtpSender parameters); it may propose new fields.
 */
export interface AudioTunables {
  /** libwebrtc software audio processing, applied via getUserMedia constraints. */
  noiseSuppression: boolean;
  autoGainControl: boolean;
  echoCancellation: boolean;
  highpassFilter: boolean;
  /** Opus encoder: target average bitrate in bits per second. */
  opusBitrateBps: number;
  /** Opus in-band forward error correction (SDP `useinbandfec`). */
  opusFec: boolean;
  /** Opus discontinuous transmission (SDP `usedtx`). Silence suppression; can clip speech in wind. */
  opusDtx: boolean;
  /** Packet time in ms (SDP `ptime` / `minptime`). */
  opusPacketTimeMs: 10 | 20 | 40 | 60;
}

export const DEFAULT_AUDIO_TUNABLES: AudioTunables = {
  noiseSuppression: true,
  autoGainControl: true,
  echoCancellation: true,
  highpassFilter: true,
  opusBitrateBps: 24_000,
  opusFec: true,
  opusDtx: false,
  opusPacketTimeMs: 20,
};

export const AUDIO_TUNABLE_LIMITS = {
  opusBitrateBps: { min: 6_000, max: 64_000 },
  opusPacketTimeMs: [10, 20, 40, 60] as const,
} as const;
