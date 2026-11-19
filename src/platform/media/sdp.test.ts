import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { DEFAULT_AUDIO_TUNABLES, type AudioTunables } from '../audio/AudioTunables';

import { applyOpusTunables, readOpusFmtp } from './sdp';

const fixture = (name: string): string => readFileSync(join(__dirname, '__fixtures__', name), 'utf8');

const OPUS_DEFAULT =
  'a=fmtp:111 minptime=20;useinbandfec=1;usedtx=0;maxaveragebitrate=24000;stereo=0;sprop-stereo=0';

describe('applyOpusTunables on real Chromium fixtures', () => {
  const offer = fixture('offer.chromium.sdp');
  const answer = fixture('answer.chromium.sdp');
  const recvOnly = fixture('offer-recvonly.chromium.sdp');

  it('fixtures are real CRLF SDP from Chromium with an Opus fmtp', () => {
    expect(offer).toContain('\r\n');
    expect(offer).toContain('a=rtpmap:111 opus/48000/2\r\n');
    expect(offer).toContain('a=fmtp:111 minptime=10;useinbandfec=1\r\n');
    expect(offer).not.toContain('a=ptime');
  });

  it('default tunables: exact output for the offer', () => {
    const expected = offer.replace(
      'a=fmtp:111 minptime=10;useinbandfec=1\r\n',
      `${OPUS_DEFAULT}\r\na=ptime:20\r\n`,
    );
    expect(applyOpusTunables(offer, DEFAULT_AUDIO_TUNABLES)).toBe(expected);
  });

  it('default tunables: exact output for the answer and the recvonly offer', () => {
    for (const sdp of [answer, recvOnly]) {
      const expected = sdp.replace(
        'a=fmtp:111 minptime=10;useinbandfec=1\r\n',
        `${OPUS_DEFAULT}\r\na=ptime:20\r\n`,
      );
      expect(expected).not.toBe(sdp);
      expect(applyOpusTunables(sdp, DEFAULT_AUDIO_TUNABLES)).toBe(expected);
    }
  });

  it('non-default tunables: exact fmtp and ptime', () => {
    const t: AudioTunables = {
      ...DEFAULT_AUDIO_TUNABLES,
      opusFec: false,
      opusDtx: true,
      opusBitrateBps: 32_000,
      opusPacketTimeMs: 40,
    };
    const expected = offer.replace(
      'a=fmtp:111 minptime=10;useinbandfec=1\r\n',
      'a=fmtp:111 minptime=40;useinbandfec=0;usedtx=1;maxaveragebitrate=32000;stereo=0;sprop-stereo=0\r\na=ptime:40\r\n',
    );
    expect(applyOpusTunables(offer, t)).toBe(expected);
  });

  it('touches nothing but the Opus fmtp and ptime lines', () => {
    const out = applyOpusTunables(offer, DEFAULT_AUDIO_TUNABLES).split('\r\n');
    const before = offer.split('\r\n');
    expect(out.filter((l) => !before.includes(l))).toEqual([OPUS_DEFAULT, 'a=ptime:20']);
    expect(before.filter((l) => !out.includes(l))).toEqual(['a=fmtp:111 minptime=10;useinbandfec=1']);
    // RED and the other codecs keep their lines, in order
    expect(out).toContain('a=fmtp:63 111/111');
    expect(out).toContain('a=rtpmap:9 G722/8000');
  });

  it('is idempotent and a second apply with other tunables replaces, never duplicates', () => {
    const once = applyOpusTunables(offer, DEFAULT_AUDIO_TUNABLES);
    expect(applyOpusTunables(once, DEFAULT_AUDIO_TUNABLES)).toBe(once);
    const other = applyOpusTunables(once, { ...DEFAULT_AUDIO_TUNABLES, opusPacketTimeMs: 60, opusDtx: true });
    expect(other.match(/a=ptime:/g)).toHaveLength(1);
    expect(other.match(/a=fmtp:111 /g)).toHaveLength(1);
    expect(other).toContain(
      'a=fmtp:111 minptime=60;useinbandfec=1;usedtx=1;maxaveragebitrate=24000;stereo=0;sprop-stereo=0\r\na=ptime:60\r\n',
    );
  });

  it('never emits a parameter twice and never emits cbr', () => {
    const fmtp = readOpusFmtp(applyOpusTunables(offer, DEFAULT_AUDIO_TUNABLES))['111'] ?? '';
    const keys = fmtp.split(';').map((p) => p.split('=')[0]);
    expect(new Set(keys).size).toBe(keys.length);
    expect(keys).not.toContain('cbr');
  });

  it('output still looks like SDP: starts with v=0, ends with CRLF, no bare LF', () => {
    const out = applyOpusTunables(offer, DEFAULT_AUDIO_TUNABLES);
    expect(out.startsWith('v=0\r\n')).toBe(true);
    expect(out.endsWith('\r\n')).toBe(true);
    expect(out.replace(/\r\n/g, '')).not.toMatch(/[\r\n]/);
  });
});

describe('applyOpusTunables on synthetic edge cases', () => {
  const head = 'v=0\no=- 1 2 IN IP4 127.0.0.1\ns=-\nt=0 0\n';

  it('adds a missing fmtp after the last rtcp-fb of the payload type and ptime after it', () => {
    const sdp = `${head}m=audio 9 UDP/TLS/RTP/SAVPF 111 0\na=mid:0\na=rtpmap:111 opus/48000/2\na=rtcp-fb:111 transport-cc\na=rtpmap:0 PCMU/8000\na=sendrecv\n`;
    expect(applyOpusTunables(sdp, DEFAULT_AUDIO_TUNABLES)).toBe(
      `${head}m=audio 9 UDP/TLS/RTP/SAVPF 111 0\na=mid:0\na=rtpmap:111 opus/48000/2\na=rtcp-fb:111 transport-cc\n${OPUS_DEFAULT}\na=ptime:20\na=rtpmap:0 PCMU/8000\na=sendrecv\n`,
    );
  });

  it('adds a missing fmtp right after rtpmap when there is no rtcp-fb', () => {
    const sdp = `${head}m=audio 9 RTP/AVP 111\na=rtpmap:111 opus/48000/2\n`;
    expect(applyOpusTunables(sdp, DEFAULT_AUDIO_TUNABLES)).toBe(
      `${head}m=audio 9 RTP/AVP 111\na=rtpmap:111 opus/48000/2\n${OPUS_DEFAULT}\na=ptime:20\n`,
    );
  });

  it('preserves LF endings and a missing trailing newline', () => {
    const sdp = `${head}m=audio 9 RTP/AVP 111\na=rtpmap:111 opus/48000/2`;
    const out = applyOpusTunables(sdp, DEFAULT_AUDIO_TUNABLES);
    expect(out).not.toContain('\r');
    expect(out.endsWith('a=rtpmap:111 opus/48000/2\n' + OPUS_DEFAULT + '\na=ptime:20')).toBe(true);
  });

  it('merges duplicate fmtp parameters and keeps unknown ones and their order', () => {
    const sdp = `${head}m=audio 9 RTP/AVP 111\na=rtpmap:111 opus/48000/2\na=fmtp:111 useinbandfec=0;foo=bar;useinbandfec=0;cbr=1;bare;maxaveragebitrate=1;maxaveragebitrate=2\n`;
    expect(applyOpusTunables(sdp, DEFAULT_AUDIO_TUNABLES)).toBe(
      `${head}m=audio 9 RTP/AVP 111\na=rtpmap:111 opus/48000/2\na=fmtp:111 useinbandfec=1;foo=bar;cbr=1;bare;maxaveragebitrate=24000;minptime=20;usedtx=0;stereo=0;sprop-stereo=0\na=ptime:20\n`,
    );
  });

  it('merges a second fmtp line for the same payload type into the first', () => {
    const sdp = `${head}m=audio 9 RTP/AVP 111\na=rtpmap:111 opus/48000/2\na=fmtp:111 foo=1\na=fmtp:111 bar=2\n`;
    const out = applyOpusTunables(sdp, DEFAULT_AUDIO_TUNABLES);
    expect(out.match(/a=fmtp:111/g)).toHaveLength(1);
    expect(out).toContain(
      'a=fmtp:111 foo=1;bar=2;minptime=20;useinbandfec=1;usedtx=0;maxaveragebitrate=24000;stereo=0;sprop-stereo=0\n',
    );
  });

  it('handles several Opus payload types, each with its own fmtp, and a single ptime', () => {
    const sdp = `${head}m=audio 9 RTP/AVP 111 112 0\na=rtpmap:111 opus/48000/2\na=fmtp:111 minptime=10\na=rtpmap:112 opus/48000/2\na=rtpmap:0 PCMU/8000\na=fmtp:0 x=1\n`;
    expect(applyOpusTunables(sdp, DEFAULT_AUDIO_TUNABLES)).toBe(
      `${head}m=audio 9 RTP/AVP 111 112 0\na=rtpmap:111 opus/48000/2\n${OPUS_DEFAULT}\na=rtpmap:112 opus/48000/2\n${OPUS_DEFAULT.replace('fmtp:111', 'fmtp:112')}\na=ptime:20\na=rtpmap:0 PCMU/8000\na=fmtp:0 x=1\n`,
    );
  });

  it('replaces an existing ptime in place and removes extra ptime lines', () => {
    const sdp = `${head}m=audio 9 RTP/AVP 111\na=ptime:10\na=rtpmap:111 opus/48000/2\na=fmtp:111 minptime=10\na=ptime:60\n`;
    const out = applyOpusTunables(sdp, { ...DEFAULT_AUDIO_TUNABLES, opusPacketTimeMs: 40 });
    expect(out).toBe(
      `${head}m=audio 9 RTP/AVP 111\na=ptime:40\na=rtpmap:111 opus/48000/2\na=fmtp:111 minptime=40;useinbandfec=1;usedtx=0;maxaveragebitrate=24000;stereo=0;sprop-stereo=0\n`,
    );
  });

  it('leaves non-Opus audio, video sections and Opus-less SDPs untouched', () => {
    const noOpus = `${head}m=audio 9 RTP/AVP 0 8\na=rtpmap:0 PCMU/8000\na=rtpmap:8 PCMA/8000\na=fmtp:0 x=1\n`;
    expect(applyOpusTunables(noOpus, DEFAULT_AUDIO_TUNABLES)).toBe(noOpus);
    const videoOnly = `${head}m=video 9 RTP/AVP 96\na=rtpmap:96 VP8/90000\na=fmtp:96 x=1\n`;
    expect(applyOpusTunables(videoOnly, DEFAULT_AUDIO_TUNABLES)).toBe(videoOnly);
    expect(applyOpusTunables('', DEFAULT_AUDIO_TUNABLES)).toBe('');
    expect(applyOpusTunables('garbage', DEFAULT_AUDIO_TUNABLES)).toBe('garbage');
  });

  it('only changes the audio section when video also has an "opus"-looking line', () => {
    const sdp = `${head}m=audio 9 RTP/AVP 111\na=rtpmap:111 opus/48000/2\nm=video 9 RTP/AVP 96\na=rtpmap:96 VP8/90000\na=fmtp:96 x=1\n`;
    const out = applyOpusTunables(sdp, DEFAULT_AUDIO_TUNABLES);
    expect(out.split('m=video')[1]).toBe(' 9 RTP/AVP 96\na=rtpmap:96 VP8/90000\na=fmtp:96 x=1\n');
  });

  it('does not match opus at another clock rate', () => {
    const sdp = `${head}m=audio 9 RTP/AVP 100\na=rtpmap:100 opus/16000/1\n`;
    expect(applyOpusTunables(sdp, DEFAULT_AUDIO_TUNABLES)).toBe(sdp);
  });

  it('accepts rtpmap without channel count and mixed-case codec name', () => {
    const sdp = `${head}m=audio 9 RTP/AVP 111\na=rtpmap:111 OPUS/48000\n`;
    expect(applyOpusTunables(sdp, DEFAULT_AUDIO_TUNABLES)).toBe(`${sdp}${OPUS_DEFAULT}\na=ptime:20\n`);
  });

  it('re-validates the tunables so NaN and out-of-range values cannot reach the SDP', () => {
    const sdp = `${head}m=audio 9 RTP/AVP 111\na=rtpmap:111 opus/48000/2\n`;
    const out = applyOpusTunables(sdp, {
      ...DEFAULT_AUDIO_TUNABLES,
      opusBitrateBps: NaN,
      opusPacketTimeMs: 33 as 20,
    });
    expect(out).toContain('maxaveragebitrate=24000');
    expect(out).toContain('a=ptime:40');
    expect(applyOpusTunables(sdp, { ...DEFAULT_AUDIO_TUNABLES, opusBitrateBps: 9e9 })).toContain(
      'maxaveragebitrate=64000',
    );
  });

  it('works on a section whose fmtp ends with a trailing semicolon', () => {
    const sdp = `${head}m=audio 9 RTP/AVP 111\na=rtpmap:111 opus/48000/2\na=fmtp:111 minptime=10;\n`;
    expect(applyOpusTunables(sdp, DEFAULT_AUDIO_TUNABLES)).toContain(`${OPUS_DEFAULT}\n`);
  });
});

describe('readOpusFmtp', () => {
  it('reads the Opus fmtp of a real offer', () => {
    expect(readOpusFmtp(fixture('offer.chromium.sdp'))).toEqual({ '111': 'minptime=10;useinbandfec=1' });
  });
});
