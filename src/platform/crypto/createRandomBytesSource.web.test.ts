import { createRandomBytesSource } from './createRandomBytesSource.web';

describe('createRandomBytesSource (web twin)', () => {
  it('returns exactly the requested number of bytes, including zero', () => {
    const source = createRandomBytesSource();
    expect(source(0)).toHaveLength(0);
    expect(source(32)).toHaveLength(32);
  });

  it('fills more than one WebCrypto chunk', () => {
    const bytes = createRandomBytesSource()(70_000);
    expect(bytes).toHaveLength(70_000);
    // The tail (second chunk) is filled too: 4464 zero bytes in a row is not going to happen by chance.
    expect(bytes.subarray(65_536).some((b) => b !== 0)).toBe(true);
  });

  it('returns different bytes on every call', () => {
    const source = createRandomBytesSource();
    expect(Buffer.from(source(32)).equals(Buffer.from(source(32)))).toBe(false);
  });

  it('throws instead of falling back to Math.random when WebCrypto is missing', () => {
    const original = Object.getOwnPropertyDescriptor(globalThis, 'crypto');
    Object.defineProperty(globalThis, 'crypto', { value: undefined, configurable: true });
    try {
      expect(() => createRandomBytesSource()(16)).toThrow('crypto.getRandomValues is not available');
    } finally {
      if (original) Object.defineProperty(globalThis, 'crypto', original);
    }
  });
});
