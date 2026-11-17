import { decodeBase64Url, encodeBase64Url } from './base64url';

describe('base64url', () => {
  it('matches RFC 4648 test vectors (unpadded)', () => {
    const enc = (s: string): string => encodeBase64Url(new TextEncoder().encode(s));
    expect(enc('')).toBe('');
    expect(enc('f')).toBe('Zg');
    expect(enc('fo')).toBe('Zm8');
    expect(enc('foo')).toBe('Zm9v');
    expect(enc('foob')).toBe('Zm9vYg');
    expect(enc('fooba')).toBe('Zm9vYmE');
    expect(enc('foobar')).toBe('Zm9vYmFy');
  });

  it('uses the url-safe alphabet', () => {
    expect(encodeBase64Url(new Uint8Array([0xfb, 0xff, 0xbe]))).toBe('-_--');
    expect([...(decodeBase64Url('-_--') ?? [])]).toEqual([0xfb, 0xff, 0xbe]);
  });

  it('round-trips every length from 0 to 70 and random-looking bytes', () => {
    for (let length = 0; length <= 70; length += 1) {
      const bytes = new Uint8Array(length).map((_, i) => (i * 37 + length * 11) & 0xff);
      const decoded = decodeBase64Url(encodeBase64Url(bytes));
      expect(decoded).not.toBeNull();
      expect([...(decoded ?? [])]).toEqual([...bytes]);
    }
  });

  it('accepts padding and rejects invalid input', () => {
    expect([...(decodeBase64Url('Zm8=') ?? [])]).toEqual([102, 111]);
    expect(decodeBase64Url('Zm9v!')).toBeNull();
    expect(decodeBase64Url('a')).toBeNull(); // one leftover sextet cannot encode a byte
    expect(decodeBase64Url('Zm 9v')).toBeNull();
    expect(decodeBase64Url('Zm+/')).toBeNull(); // standard alphabet is not base64url
  });
});
