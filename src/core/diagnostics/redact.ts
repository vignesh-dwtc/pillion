import IDENTITY from '../../../config/identity.json';
import type { LogData } from '../common/types';

/**
 * Redaction for logs and exports. Two independent layers, because either alone can be fooled:
 *  1. by KEY: any data key matching SENSITIVE_KEY has its value replaced, whatever the value looks like
 *     (this is the rule in src/core/common/types.ts, applied to every Logger implementation);
 *  2. by VALUE: any string that looks like a 32-byte secret (64 hex characters, or base64 / base64url of 32 bytes)
 *     is replaced wherever it appears, in data values and in free text. This catches a secret that was logged under
 *     an innocent key or pasted into a message.
 *     The same layer also catches (a) a pairing string (`<pairingPrefix><version>:<base64url payload>`, prefix from
 *     config/identity.json) and (b) a 32-byte secret glued to other characters inside a longer token.
 * Callers must still never log such values; this is the safety net, not the policy.
 *
 * Limits of the value layer (heuristics, deliberately conservative to avoid false-positive explosions):
 *  - a glued secret is found only inside a run of base64/base64url characters (A-Z a-z 0-9 + / _ -) that is longer
 *    than 43 characters and contains a 43-character window mixing upper case, lower case and digits (random
 *    base64 does with probability ~99.9%; plain words, slugs and UUIDs do not), or 64 consecutive hex digits anywhere in the run
 *    (a longer hex run, a hash for instance, is redacted whole: no loss). A secret split by other characters, or re-encoded
 *    (for example with spaces or line breaks inserted), is not recognised;
 *  - the Wi-Fi passphrase has no recognisable shape: it is removed, also when glued to other text, only through
 *    `RedactOptions.literals` (substring match); without the literal nothing can tell it from ordinary text.
 */

export const REDACTED = '[redacted]';

/** Keys whose values are never kept. Matches the contract in src/core/common/types.ts. */
export const SENSITIVE_KEY = /secret|passphrase|password|key|mac|proof|nonce|token/i;

export const MAX_TAG_CHARS = 48;
export const MAX_MESSAGE_CHARS = 400;
export const MAX_VALUE_CHARS = 200;
export const MAX_DATA_KEYS = 16;

// A run of base64/base64url characters with at most one trailing '=' (padding). Anything shorter or longer than a
// 32-byte encoding is left alone.
const TOKEN = /[A-Za-z0-9+/_-]+=?/g;
const HEX_64 = /^[0-9A-Fa-f]{64}$/;
const BASE64_43 = /^[A-Za-z0-9+/]{43}$/;
const BASE64URL_43 = /^[A-Za-z0-9_-]{43}$/;

/** True when `token` is exactly the encoding of 32 bytes: 64 hex, 43 base64url, or 43 base64 plus '='. */
export function looksLikeSecret(token: string): boolean {
  if (token.length === 64) return HEX_64.test(token);
  if (token.length === 44 && token.endsWith('=')) return BASE64_43.test(token.slice(0, 43));
  if (token.length === 43) return BASE64_43.test(token) || BASE64URL_43.test(token);
  return false;
}

const PREFIX = String(IDENTITY.pairingPrefix).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
/** A pairing string: prefix, version digits, ':' and the base64url payload (with optional padding). */
const PAIRING_STRING = new RegExp(`${PREFIX}\\d+:[A-Za-z0-9_-]+=*`, 'g');
const HEX_RUN_64 = /[0-9A-Fa-f]{64}/;

/** True when a base64/base64url run longer than a secret holds a window that looks like one (see the limits above). */
function containsEmbeddedSecret(token: string): boolean {
  if (token.length <= 43) return false;
  if (HEX_RUN_64.test(token)) return true;
  for (let start = 0; start + 43 <= token.length; start += 1) {
    let upper = false;
    let lower = false;
    let digit = false;
    for (let i = start; i < start + 43; i += 1) {
      const code = token.charCodeAt(i);
      if (code >= 65 && code <= 90) upper = true;
      else if (code >= 97 && code <= 122) lower = true;
      else if (code >= 48 && code <= 57) digit = true;
    }
    if (upper && lower && digit) return true;
  }
  return false;
}

export interface RedactOptions {
  /** Exact values that must never appear (the pairing secret, the Wi-Fi passphrase). Shorter than 6 are ignored. */
  literals?: readonly string[];
}

/** Replaces secret-looking tokens and the given literals inside free text. */
export function redactText(text: string, options: RedactOptions = {}): string {
  let out = text.replace(PAIRING_STRING, REDACTED);
  out = out.replace(TOKEN, (token) =>
    looksLikeSecret(token) || containsEmbeddedSecret(token) ? REDACTED : token,
  );
  for (const literal of options.literals ?? []) {
    if (typeof literal === 'string' && literal.length >= 6 && out.includes(literal)) {
      out = out.split(literal).join(REDACTED);
    }
  }
  return out;
}

export function truncate(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max)}...` : text;
}

/** Strips control characters so one entry is always one line of text. */
function singleLine(text: string): string {
  let out = '';
  for (const ch of text) {
    const code = ch.codePointAt(0) ?? 0;
    out += code < 0x20 || code === 0x7f ? ' ' : ch;
  }
  return out;
}

/** A string safe to store or print: no secrets, one line, bounded. */
export function cleanText(text: unknown, max: number, options: RedactOptions = {}): string {
  const raw = typeof text === 'string' ? text : safeString(text);
  return truncate(singleLine(redactText(raw, options)), max);
}

function safeString(value: unknown): string {
  try {
    return String(value);
  } catch {
    return '[unprintable]';
  }
}

/**
 * Redacts a data payload: sensitive keys lose their value, strings lose secret-looking tokens, anything that is
 * not a flat primitive is turned into a short string. Returns a new object; never throws.
 */
export function redactData(data: unknown, options: RedactOptions = {}): LogData | undefined {
  if (data === null || typeof data !== 'object') return undefined;
  const out: LogData = {};
  let kept = 0;
  let entries: [string, unknown][];
  try {
    entries = Object.entries(data as Record<string, unknown>);
  } catch {
    return undefined;
  }
  for (const [key, value] of entries) {
    if (kept >= MAX_DATA_KEYS) break;
    const safeKey = cleanText(key, MAX_TAG_CHARS);
    if (SENSITIVE_KEY.test(key)) {
      out[safeKey] = REDACTED;
    } else if (typeof value === 'string') {
      out[safeKey] = cleanText(value, MAX_VALUE_CHARS, options);
    } else if (typeof value === 'number') {
      out[safeKey] = Number.isFinite(value) ? value : String(value);
    } else if (typeof value === 'boolean' || value === null) {
      out[safeKey] = value;
    } else if (value === undefined) {
      continue;
    } else {
      out[safeKey] = cleanText(value, MAX_VALUE_CHARS, options);
    }
    kept += 1;
  }
  return out;
}
