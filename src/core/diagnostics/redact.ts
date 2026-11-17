import type { LogData } from '../common/types';

/**
 * Redaction for logs and exports. Two independent layers, because either alone can be fooled:
 *  1. by KEY: any data key matching SENSITIVE_KEY has its value replaced, whatever the value looks like
 *     (this is the rule in src/core/common/types.ts, applied to every Logger implementation);
 *  2. by VALUE: any string that looks like a 32-byte secret (64 hex characters, or base64 / base64url of 32 bytes)
 *     is replaced wherever it appears, in data values and in free text. This catches a secret that was logged under
 *     an innocent key or pasted into a message.
 * Callers must still never log such values; this is the safety net, not the policy.
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

export interface RedactOptions {
  /** Exact values that must never appear (the pairing secret, the Wi-Fi passphrase). Shorter than 6 are ignored. */
  literals?: readonly string[];
}

/** Replaces secret-looking tokens and the given literals inside free text. */
export function redactText(text: string, options: RedactOptions = {}): string {
  let out = text.replace(TOKEN, (token) => (looksLikeSecret(token) ? REDACTED : token));
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
