import { REDACTED, SENSITIVE_KEY, looksLikeSecret, redactData, redactText } from './redact';

const HEX = 'a1'.repeat(32);
const B64URL = 'Zm9vYmFyYmF6cXV4MTIzNDU2Nzg5MGFiY2RlZmdoaWo'; // 43 chars
const B64 = `${B64URL.replace(/-/g, '+').replace(/_/g, '/')}=`;

describe('looksLikeSecret', () => {
  it('flags 32-byte encodings only', () => {
    expect(B64URL).toHaveLength(43);
    expect(looksLikeSecret(HEX)).toBe(true);
    expect(looksLikeSecret(B64URL)).toBe(true);
    expect(looksLikeSecret(B64)).toBe(true);
    expect(looksLikeSecret('a1'.repeat(16))).toBe(false); // a 16-byte pair id
    expect(looksLikeSecret('short')).toBe(false);
    expect(looksLikeSecret('g'.repeat(64))).toBe(false); // not hex
    expect(looksLikeSecret(`${B64URL}x`)).toBe(false);
  });
});

describe('redactData', () => {
  it('replaces the value of every sensitive key, whatever it looks like', () => {
    const out = redactData({
      secret: 'x',
      passphrase: 'x',
      Password: 'x',
      apiKey: 'x',
      mac: 'x',
      authProof: 'x',
      nonce: 1,
      sessionToken: 'x',
      role: 'host',
    });
    expect(out).toEqual({
      secret: REDACTED,
      passphrase: REDACTED,
      Password: REDACTED,
      apiKey: REDACTED,
      mac: REDACTED,
      authProof: REDACTED,
      nonce: REDACTED,
      sessionToken: REDACTED,
      role: 'host',
    });
    for (const key of ['secret', 'passphrase', 'password', 'key', 'mac', 'proof', 'nonce', 'token']) {
      expect(SENSITIVE_KEY.test(key)).toBe(true);
    }
  });

  it('redacts secret-looking values under innocent keys and inside text', () => {
    const out = redactData({ note: `value ${HEX} trailing`, other: B64URL, fine: 'hello world' });
    expect(JSON.stringify(out)).not.toContain(HEX);
    expect(JSON.stringify(out)).not.toContain(B64URL);
    expect(out?.fine).toBe('hello world');
  });

  it('redacts given literals', () => {
    const out = redactData({ detail: 'joined with hunter22 ok' }, { literals: ['hunter22'] });
    expect(out?.detail).toBe(`joined with ${REDACTED} ok`);
  });

  it('keeps primitives, flattens objects, bounds size, never throws', () => {
    const hostile = {
      get boom(): string {
        throw new Error('getter');
      },
    };
    expect(redactData(hostile)).toBeUndefined();
    const out = redactData({
      n: 5,
      b: true,
      z: null,
      u: undefined,
      nested: { a: 1 },
      inf: Infinity,
      long: 'y'.repeat(1000),
    });
    expect(out?.n).toBe(5);
    expect(out?.b).toBe(true);
    expect(out?.z).toBeNull();
    expect('u' in (out ?? {})).toBe(false);
    expect(typeof out?.nested).toBe('string');
    expect(out?.inf).toBe('Infinity');
    expect(String(out?.long).length).toBeLessThan(300);
    const many: Record<string, number> = {};
    for (let i = 0; i < 50; i++) many[`k${i}`] = i;
    expect(Object.keys(redactData(many) ?? {}).length).toBeLessThanOrEqual(16);
    expect(redactData(null)).toBeUndefined();
    expect(redactData('str')).toBeUndefined();
  });
});

describe('redactText', () => {
  it('replaces tokens in free text and leaves other text alone', () => {
    expect(redactText(`a ${HEX} b`)).toBe(`a ${REDACTED} b`);
    expect(redactText('pair id AAAAAAAAAAAAAAAAAAAAAA is fine')).toBe(
      'pair id AAAAAAAAAAAAAAAAAAAAAA is fine',
    );
  });

  it('ignores literals shorter than 6 characters', () => {
    expect(redactText('abc abc', { literals: ['abc'] })).toBe('abc abc');
  });
});
