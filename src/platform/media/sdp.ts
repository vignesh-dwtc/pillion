/**
 * Opus SDP munging for the audio tunables. Pure string processing (no DOM, no react-native): shared by the native
 * engine and the web twin, unit-tested against real Chromium offers/answers (`__fixtures__/`).
 *
 * What is written for every Opus payload type (`a=rtpmap:<pt> opus/48000/2`) of every `m=audio` section:
 *   fmtp   minptime, useinbandfec, usedtx, maxaveragebitrate, stereo=0, sprop-stereo=0
 *   attr   `a=ptime:<ms>` (once per audio section)
 * Existing fmtp parameters are updated in place (keeping their order), unknown ones are preserved, duplicates
 * collapse to one (last value wins), new ones are appended in the fixed order above. A missing fmtp line is added
 * after the payload type's last rtpmap/rtcp-fb line. Everything else (CRLF vs LF, trailing newline, other codecs,
 * other lines) is preserved byte for byte, and the function is idempotent.
 *
 * `cbr` is deliberately NOT written: constrained VBR gives better quality for the same average bitrate, and the
 * link is a direct local one, so CBR's predictable packet size buys nothing. An existing `cbr` is left untouched.
 *
 * Semantics worth knowing: each side munges its OWN local description, so `maxaveragebitrate`, `minptime` and
 * `ptime` state what that side wants to RECEIVE; libwebrtc's sender honours them. The sender-side cap is also set
 * with RTCRtpSender.setParameters (maxBitrate) by the engine.
 */
import { clampTunables } from '../audio/tunables';
import type { AudioTunables } from '../audio/AudioTunables';

const OPUS_RTPMAP = /^a=rtpmap:(\d+) opus\/48000(?:\/\d+)?\s*$/i;

interface FmtpEntry {
  key: string;
  value: string | null; // null = bare token without '='
}

function parseFmtpBody(body: string): FmtpEntry[] {
  const entries: FmtpEntry[] = [];
  for (const part of body.split(';')) {
    const trimmed = part.trim();
    if (trimmed === '') continue;
    const equals = trimmed.indexOf('=');
    const key = equals === -1 ? trimmed : trimmed.slice(0, equals).trim();
    const value = equals === -1 ? null : trimmed.slice(equals + 1).trim();
    const existing = entries.find((entry) => entry.key === key);
    if (existing)
      existing.value = value; // duplicate parameter: collapse, last wins
    else entries.push({ key, value });
  }
  return entries;
}

function wantedParameters(t: AudioTunables): [string, string][] {
  return [
    ['minptime', String(t.opusPacketTimeMs)],
    ['useinbandfec', t.opusFec ? '1' : '0'],
    ['usedtx', t.opusDtx ? '1' : '0'],
    ['maxaveragebitrate', String(t.opusBitrateBps)],
    ['stereo', '0'],
    ['sprop-stereo', '0'],
  ];
}

function buildFmtp(payloadType: string, existingBodies: string[], t: AudioTunables): string {
  const entries = parseFmtpBody(existingBodies.join(';'));
  for (const [key, value] of wantedParameters(t)) {
    const existing = entries.find((entry) => entry.key === key);
    if (existing) existing.value = value;
    else entries.push({ key, value });
  }
  const body = entries.map((entry) => (entry.value === null ? entry.key : `${entry.key}=${entry.value}`));
  return `a=fmtp:${payloadType} ${body.join(';')}`;
}

function fmtpPayloadType(line: string): string | null {
  return /^a=fmtp:(\d+)(?:\s|$)/.exec(line)?.[1] ?? null;
}

function fmtpBody(line: string): string {
  const space = line.indexOf(' ');
  return space === -1 ? '' : line.slice(space + 1);
}

function mungeAudioSection(lines: string[], t: AudioTunables): string[] {
  const opusPayloadTypes: string[] = [];
  for (const line of lines) {
    const pt = OPUS_RTPMAP.exec(line)?.[1];
    if (pt !== undefined && !opusPayloadTypes.includes(pt)) opusPayloadTypes.push(pt);
  }
  if (opusPayloadTypes.length === 0) return lines;

  // 1. fmtp: rewrite the first fmtp line of each Opus payload type, drop further ones (merged into the first).
  let out: string[] = [];
  const handled = new Set<string>();
  for (const line of lines) {
    const pt = fmtpPayloadType(line);
    if (pt === null || !opusPayloadTypes.includes(pt)) {
      out.push(line);
      continue;
    }
    if (handled.has(pt)) continue;
    handled.add(pt);
    const bodies = lines
      .filter((candidate) => fmtpPayloadType(candidate) === pt)
      .map((candidate) => fmtpBody(candidate));
    out.push(buildFmtp(pt, bodies, t));
  }

  // 2. Opus payload types that had no fmtp line get one after their last rtpmap / rtcp-fb line.
  for (const pt of opusPayloadTypes) {
    if (handled.has(pt)) continue;
    const owner = new RegExp(`^a=(?:rtpmap|rtcp-fb):${pt}(?:\\s|$)`);
    let at = -1;
    out.forEach((line, index) => {
      if (owner.test(line)) at = index;
    });
    out.splice(at + 1, 0, buildFmtp(pt, [], t));
  }

  // 3. a=ptime: exactly one, replacing the first existing one in place, else right after the last Opus fmtp line.
  const ptime = `a=ptime:${t.opusPacketTimeMs}`;
  const firstPtime = out.findIndex((line) => /^a=ptime:/.test(line));
  if (firstPtime !== -1) {
    out = out.filter((line, index) => !/^a=ptime:/.test(line) || index === firstPtime);
    out[out.findIndex((line) => /^a=ptime:/.test(line))] = ptime;
  } else {
    let at = -1;
    out.forEach((line, index) => {
      const pt = fmtpPayloadType(line);
      if (pt !== null && opusPayloadTypes.includes(pt)) at = index;
    });
    out.splice(at + 1, 0, ptime);
  }
  return out;
}

/**
 * Rewrites the Opus parameters of an offer or answer for the tunables. An SDP without an audio m-section with
 * Opus/48000 is returned unchanged. Never throws on a malformed string (returns it unchanged if there is no
 * `m=audio`); the tunables are re-validated, so NaN or out-of-range values cannot reach the SDP.
 */
export function applyOpusTunables(sdp: string, tunables: AudioTunables): string {
  if (typeof sdp !== 'string' || sdp === '' || !sdp.includes('m=audio')) return sdp;
  const t = clampTunables(tunables);
  const eol = sdp.includes('\r\n') ? '\r\n' : '\n';
  const trailing = sdp.endsWith('\n');
  const lines = sdp.split(/\r?\n/);
  if (trailing) lines.pop();

  const out: string[] = [];
  let section: string[] = [];
  let isAudio = false;
  const flush = () => {
    out.push(...(isAudio ? mungeAudioSection(section, t) : section));
    section = [];
  };
  for (const line of lines) {
    if (line.startsWith('m=')) {
      flush();
      isAudio = line.startsWith('m=audio ');
    }
    section.push(line);
  }
  flush();
  return out.join(eol) + (trailing ? eol : '');
}

/** The Opus parameters found in an SDP, for diagnostics and tests: `payloadType -> fmtp body`. */
export function readOpusFmtp(sdp: string): Record<string, string> {
  const lines = sdp.split(/\r?\n/);
  const result: Record<string, string> = {};
  const opus = new Set<string>();
  for (const line of lines) {
    const pt = OPUS_RTPMAP.exec(line)?.[1];
    if (pt !== undefined) opus.add(pt);
  }
  for (const line of lines) {
    const pt = fmtpPayloadType(line);
    if (pt !== null && opus.has(pt)) result[pt] = fmtpBody(line);
  }
  return result;
}
