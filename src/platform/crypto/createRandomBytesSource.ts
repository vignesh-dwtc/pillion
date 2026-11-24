import { getRandomValues } from 'expo-crypto';

import type { RandomBytesSource } from '../../core/protocol/crypto';

/**
 * Native randomness for the CryptoProvider: expo-crypto's `getRandomValues`, which fills the array from the platform
 * CSPRNG (java.security.SecureRandom on Android) through a synchronous native call.
 *
 * Deliberately NOT `getRandomBytes`: in expo-crypto 58 that function silently falls back to `Math.random` in __DEV__
 * builds whenever `global.nativeCallSyncHook` is missing, and React Native's bridgeless New Architecture does not
 * install that hook. A debug APK would then generate pairing secrets from Math.random. `getRandomValues` has no
 * such fallback. The web twin (`createRandomBytesSource.web.ts`) uses the browser's crypto.getRandomValues.
 */
export function createRandomBytesSource(): RandomBytesSource {
  return (length: number): Uint8Array => {
    const bytes = new Uint8Array(length);
    if (length > 0) getRandomValues(bytes);
    return bytes;
  };
}
