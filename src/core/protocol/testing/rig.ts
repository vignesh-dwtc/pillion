/// <reference types="node" />
import { base64urlEncode } from '../base64url';
import type { CryptoProvider } from '../crypto';
import { FrameDecoder } from '../frame';
import { createCryptoProvider } from '../noble';
import { ProtocolError, type SecureChannel, type SecureChannelOptions } from '../secureChannel';
import { pattern } from './hex';
import { createMemoryPipe, type MemoryEnd, type PipeOptions } from './memoryPipe';
import { seededRandomBytes } from './rng';
import { ManualTimers } from './timers';

/** Fixed, obviously fake fixtures. Nothing here is, or resembles, a real pairing secret. */
export const SECRET = pattern(32, 0x10);
export const OTHER_SECRET = pattern(32, 0x90);
export const PAIR_ID = base64urlEncode(pattern(16, 0x70));
export const OTHER_PAIR_ID = base64urlEncode(pattern(16, 0x20));

export interface CallCounts {
  randomBytes: number;
  hmacSha256: number;
  hkdfSha256: number;
  timingSafeEqual: number;
}

/** Wraps a provider and counts calls; `ikm` collects every HKDF input-key-material array that was passed in. */
export function countingCrypto(base: CryptoProvider): {
  crypto: CryptoProvider;
  calls: CallCounts;
  total(): number;
  ikm: Uint8Array[];
} {
  const calls: CallCounts = { randomBytes: 0, hmacSha256: 0, hkdfSha256: 0, timingSafeEqual: 0 };
  const ikm: Uint8Array[] = [];
  const crypto: CryptoProvider = {
    randomBytes: (length) => {
      calls.randomBytes += 1;
      return base.randomBytes(length);
    },
    hmacSha256: (key, data) => {
      calls.hmacSha256 += 1;
      return base.hmacSha256(key, data);
    },
    hkdfSha256: (input, salt, info, length) => {
      calls.hkdfSha256 += 1;
      ikm.push(input);
      return base.hkdfSha256(input, salt, info, length);
    },
    timingSafeEqual: (a, b) => {
      calls.timingSafeEqual += 1;
      return base.timingSafeEqual(a, b);
    },
  };
  return { crypto, calls, total: () => Object.values(calls).reduce((sum, n) => sum + n, 0), ikm };
}

export interface Rig {
  timers: ManualTimers;
  guestEnd: MemoryEnd;
  hostEnd: MemoryEnd;
  guestCrypto: CryptoProvider;
  hostCrypto: CryptoProvider;
  guestOptions(overrides?: Partial<SecureChannelOptions>): SecureChannelOptions;
  hostOptions(overrides?: Partial<SecureChannelOptions>): SecureChannelOptions;
}

/** Two pipe ends plus deterministic, independent randomness per side (same seed: same nonces, same keys). */
export function makeRig(options: { pipe?: PipeOptions; seed?: number; timers?: ManualTimers } = {}): Rig {
  const seed = options.seed ?? 1;
  const { a, b } = createMemoryPipe(options.pipe);
  const guestCrypto = createCryptoProvider(seededRandomBytes(seed * 1000 + 1));
  const hostCrypto = createCryptoProvider(seededRandomBytes(seed * 1000 + 2));
  // Manual timers by default: a handshake left pending at the end of a test must not keep a real 5 s timer alive.
  const timers = options.timers ?? new ManualTimers();
  const timerOptions = { setTimeout: timers.setTimeout, clearTimeout: timers.clearTimeout };
  return {
    timers,
    guestEnd: a,
    hostEnd: b,
    guestCrypto,
    hostCrypto,
    guestOptions: (overrides = {}) => ({
      role: 'guest',
      pairId: PAIR_ID,
      secret: SECRET,
      crypto: guestCrypto,
      ...timerOptions,
      ...overrides,
    }),
    hostOptions: (overrides = {}) => ({
      role: 'host',
      pairId: PAIR_ID,
      secret: SECRET,
      crypto: hostCrypto,
      ...timerOptions,
      ...overrides,
    }),
  };
}

export type Outcome = { ok: true; channel: SecureChannel } | { ok: false; error: unknown };

export function outcome(promise: Promise<SecureChannel>): Promise<Outcome> {
  return promise.then(
    (channel) => ({ ok: true, channel }) as const,
    (error: unknown) => ({ ok: false, error }) as const,
  );
}

/** The ProtocolError code of a failed outcome, `TypeError` etc. by class name, or `ok`. */
export function codeOf(result: Outcome): string {
  if (result.ok) return 'ok';
  if (result.error instanceof ProtocolError) return result.error.code;
  return result.error instanceof Error ? result.error.constructor.name : 'non-error';
}

/** Payloads of the frames an end has sent, decoded from its recorded send() calls. */
export function framesSentBy(end: MemoryEnd): Uint8Array[] {
  const decoder = new FrameDecoder();
  const frames: Uint8Array[] = [];
  for (const bytes of end.sent) {
    decoder.push(bytes);
    for (let frame = decoder.next(); frame !== null; frame = decoder.next()) frames.push(frame);
  }
  return frames;
}

/** Every textual form in which key material might leak into a message or stack trace. */
function forms(bytes: Uint8Array): { label: string; text: string }[] {
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  const b64 = Buffer.from(bytes).toString('base64');
  return [
    { label: 'hex', text: hex },
    { label: 'HEX', text: hex.toUpperCase() },
    { label: 'base64', text: b64 },
    { label: 'base64url', text: b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '') },
    { label: 'decimal list', text: Array.from(bytes.subarray(0, 8)).join(',') },
    { label: 'hex prefix', text: hex.slice(0, 16) },
  ];
}

/**
 * Throws if any of `secrets` appears, in any common encoding, in any of `texts`. The failure message names which
 * secret and which text, never their content, so a leak is not made worse by the test output.
 */
export function assertNoLeak(texts: Record<string, string>, secrets: Record<string, Uint8Array>): void {
  for (const [secretName, bytes] of Object.entries(secrets)) {
    for (const { label, text } of forms(bytes)) {
      for (const [where, haystack] of Object.entries(texts)) {
        if (haystack.includes(text)) {
          throw new Error(`LEAK: ${secretName} appears as ${label} in ${where}`);
        }
      }
    }
  }
}

/** Everything an Error exposes to a logger or a crash report. */
export function describeError(error: unknown): Record<string, string> {
  const e = error as Error & { code?: string };
  let inspected = '';
  try {
    inspected = JSON.stringify(error, Object.getOwnPropertyNames(error as object));
  } catch {
    inspected = '';
  }
  return {
    message: String(e.message),
    stack: String(e.stack ?? ''),
    string: String(error),
    json: inspected,
  };
}
