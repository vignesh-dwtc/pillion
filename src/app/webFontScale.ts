/**
 * Web verification toggle: `?fontScale=1.3` emulates the system font scale (React Native Web ignores it), capped per
 * variant exactly like `maxFontSizeMultiplier` on Android. 1 everywhere else (no `location` on Android).
 */
const initialSearch =
  typeof globalThis === 'object' && 'location' in globalThis
    ? (globalThis as { location?: { search?: string } }).location?.search
    : undefined;

export function fontScaleFromSearch(search: string | undefined): number {
  const match = /[?&]fontScale=([\d.]+)/.exec(search ?? '');
  const value = match?.[1] ? Number(match[1]) : 1;
  return Number.isFinite(value) && value >= 1 && value <= 2 ? value : 1;
}

export const webFontScale = fontScaleFromSearch(initialSearch);
