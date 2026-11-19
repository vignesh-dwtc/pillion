/**
 * Storage ports. CONTRACT: owned by the lead. Implementations: `ui` (src/platform/storage).
 *
 * SecureStore   - Keystore-backed on Android (expo-secure-store); holds pairing records. Web: localStorage (dev only,
 *                 clearly insecure).
 * KeyValueStore - synchronous, fast, not secret: settings, audio tunables, onboarding flags, the diagnostics ring
 *                 buffer. Android: MMKV. Web: MMKV's own web fallback or localStorage.
 */

export interface SecureStore {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  deleteItem(key: string): Promise<void>;
}

export interface KeyValueStore {
  getString(key: string): string | undefined;
  setString(key: string, value: string): void;
  delete(key: string): void;
  getAllKeys(): string[];
}
