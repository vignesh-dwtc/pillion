import { ProtocolError } from '../protocol/secureChannel';
import type { SessionErrorCode } from './types';

/**
 * Error mapping: every failure that can happen below the state machine (link, protocol, media, platform) becomes
 * one `Failure` with a `SessionErrorCode`, a fixed human-readable message and a `recoverable` flag.
 *
 * `message` is ALWAYS one of the fixed strings below, never text from a lower layer: foreign messages can carry
 * addresses, credentials or stack noise. The raw text travels in `detail`, which only ever goes to the log, after
 * the session has scrubbed the pairing secret and the Wi-Fi passphrase out of it.
 *
 * Recoverability rule: anything that depends on what the partner or the network does is recoverable (the session
 * keeps retrying for as long as the ride is active). Only things that retrying cannot fix (a missing permission,
 * no headset at start, a failed local resource) are not, and those end the ride.
 *
 * Authentication and version failures during the handshake are deliberately recoverable: the `reject` message is
 * an unauthenticated hint and any device on the link can open a connection and fail the handshake, so letting
 * either end the ride would let a stranger kill it (see docs/DECISIONS.md). The UI shows the error and the
 * session keeps retrying until the user ends the ride.
 */

export interface Failure {
  code: SessionErrorCode;
  /** Fixed, user-facing text. Never contains lower-layer text. */
  message: string;
  recoverable: boolean;
  /** Raw lower-layer text for the log only; must be scrubbed before use. */
  detail?: string;
}

/** Thrown inside the start sequence to end the ride with a specific error. */
export class FatalFailure extends Error {
  readonly failure: Failure;
  constructor(failure: Failure) {
    super(failure.message);
    this.name = 'FatalFailure';
    this.failure = failure;
  }
}

const MAX_DETAIL_CHARS = 200;

/** A short single-line description of anything thrown, for logs. */
export function describeError(error: unknown): string {
  let text: string;
  if (error instanceof Error) {
    text = error.message || error.name;
  } else if (typeof error === 'string') {
    text = error;
  } else {
    try {
      text = JSON.stringify(error) ?? String(error);
    } catch {
      text = 'unknown error';
    }
  }
  text = text.replace(/\s+/g, ' ').trim();
  return text.length > MAX_DETAIL_CHARS ? `${text.slice(0, MAX_DETAIL_CHARS)}...` : text;
}

/** `error.code` when `error` is an Error named `name` (instanceof-free, so duplicate module copies still match). */
function codeOf(error: unknown, name: string): string | null {
  if (typeof error === 'object' && error !== null) {
    const candidate = error as { name?: unknown; code?: unknown };
    if (candidate.name === name && typeof candidate.code === 'string') return candidate.code;
  }
  return null;
}

const CONNECTION_LOST: Failure = {
  code: 'link-unavailable',
  message: 'The connection to your partner was lost.',
  recoverable: true,
};

export function failureFromLinkError(error: unknown): Failure {
  const code = codeOf(error, 'LinkError');
  const detail = describeError(error);
  switch (code) {
    case 'unavailable':
      return {
        code: 'link-unavailable',
        message: 'The connection is not available right now.',
        recoverable: true,
        detail,
      };
    case 'permission':
      return {
        code: 'permission-denied',
        message: 'A permission needed to reach your partner is missing.',
        recoverable: false,
        detail,
      };
    case 'timeout':
      return {
        code: 'link-unavailable',
        message: 'Your partner was not found in time.',
        recoverable: true,
        detail,
      };
    case 'aborted':
      return { code: 'link-unavailable', message: 'Connecting was interrupted.', recoverable: true, detail };
    case 'discovery-failed':
      return { code: 'link-unavailable', message: 'Could not find your partner.', recoverable: true, detail };
    case 'connect-failed':
      return {
        code: 'link-unavailable',
        message: 'Could not connect to your partner.',
        recoverable: true,
        detail,
      };
    case 'unsupported':
      return {
        code: 'link-unavailable',
        message: 'This connection type is not supported on this phone.',
        recoverable: false,
        detail,
      };
    default:
      return { ...CONNECTION_LOST, detail };
  }
}

function failureFromProtocolCode(code: string, detail: string): Failure {
  switch (code) {
    case 'handshake-timeout':
      return {
        code: 'link-unavailable',
        message: 'Your partner did not answer in time.',
        recoverable: true,
        detail,
      };
    case 'unsupported-version':
      return {
        code: 'version-mismatch',
        message: 'Your partner runs an incompatible app version.',
        recoverable: true,
        detail,
      };
    case 'unknown-pair':
    case 'bad-proof':
      return {
        code: 'auth-failed',
        message: 'Could not verify your partner. Check that both phones are paired with each other.',
        recoverable: true,
        detail,
      };
    case 'bad-mac':
      return {
        code: 'auth-failed',
        message: 'A message from your partner failed verification.',
        recoverable: true,
        detail,
      };
    case 'busy':
      return { code: 'link-unavailable', message: 'Your partner is busy.', recoverable: true, detail };
    case 'malformed-frame':
    case 'frame-too-large':
      return {
        code: 'link-unavailable',
        message: 'Received unreadable data from your partner.',
        recoverable: true,
        detail,
      };
    case 'closed':
    default:
      return { ...CONNECTION_LOST, detail };
  }
}

/** Failure of the handshake or of an authenticated channel (ProtocolError), or of anything else thrown there. */
export function failureFromProtocolError(error: unknown): Failure {
  const detail = describeError(error);
  if (error instanceof ProtocolError) return failureFromProtocolCode(error.code, detail);
  const code = codeOf(error, 'ProtocolError');
  if (code !== null) return failureFromProtocolCode(code, detail);
  return { ...CONNECTION_LOST, detail };
}

/** A `onClose` reason string: a LinkCloseReason from the transport or a ProtocolErrorCode from the channel. */
export function failureFromCloseReason(reason: string, detail?: string): Failure {
  switch (reason) {
    case 'local-close':
      return { ...CONNECTION_LOST, detail: 'closed locally' };
    case 'remote-close':
      return {
        code: 'link-unavailable',
        message: 'Your partner closed the connection.',
        recoverable: true,
        detail: detail ?? reason,
      };
    case 'network-lost':
      return {
        code: 'link-unavailable',
        message: 'The network connection was lost.',
        recoverable: true,
        detail: detail ?? reason,
      };
    case 'io-error':
    case 'timeout':
    case 'aborted':
      return { ...CONNECTION_LOST, detail: detail ? `${reason}: ${detail}` : reason };
    default:
      return failureFromProtocolCode(reason, detail ? `${reason}: ${detail}` : reason);
  }
}

/** Failure while the media engine is already running (createSession, SDP handling). */
export function failureFromMediaError(error: unknown): Failure {
  const code = codeOf(error, 'MediaError');
  const detail = describeError(error);
  switch (code) {
    case 'permission':
      return {
        code: 'permission-denied',
        message: 'Microphone access was denied.',
        recoverable: false,
        detail,
      };
    case 'unsupported':
      return {
        code: 'media-failed',
        message: 'Audio calls are not supported on this phone.',
        recoverable: false,
        detail,
      };
    default:
      return {
        code: 'media-failed',
        message: 'Could not set up the audio connection.',
        recoverable: true,
        detail,
      };
  }
}

/** Failure of media.start(): the microphone could not be acquired. Retrying inside the ride cannot fix it. */
export function failureFromMediaStartError(error: unknown): Failure {
  const code = codeOf(error, 'MediaError');
  const detail = describeError(error);
  if (code === 'permission') {
    return {
      code: 'permission-denied',
      message: 'Microphone access was denied.',
      recoverable: false,
      detail,
    };
  }
  return {
    code: 'media-failed',
    message: 'Could not start the microphone.',
    recoverable: false,
    detail,
  };
}

export const FAILURES = {
  heartbeatTimeout: {
    code: 'link-unavailable',
    message: 'Your partner stopped responding.',
    recoverable: true,
  },
  signalingTimeout: {
    code: 'link-unavailable',
    message: 'Your partner did not finish connecting.',
    recoverable: true,
  },
  linkOpenTimeout: {
    code: 'link-unavailable',
    message: 'Your partner was not found in time.',
    recoverable: true,
  },
  negotiationTimeout: {
    code: 'media-failed',
    message: 'The audio connection could not be established in time.',
    recoverable: true,
  },
  mediaFailed: {
    code: 'media-failed',
    message: 'The audio connection failed.',
    recoverable: true,
  },
  mediaLost: {
    code: 'media-failed',
    message: 'The audio connection was lost.',
    recoverable: true,
  },
  unexpected: {
    code: 'unknown',
    message: 'Something went wrong. Trying again.',
    recoverable: true,
  },
} as const satisfies Record<string, Failure>;
