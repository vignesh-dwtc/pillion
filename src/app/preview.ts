import { createStore } from 'zustand/vanilla';

import type { SessionSnapshot } from '../core/session/types';

import { SAMPLE_SESSION } from './placeholders';

/**
 * M0 PLACEHOLDER: which sample session the ride screen shows until the live SessionController arrives in M1.
 * Chosen on the debug screen, or on web with `?preview=<variant>` (screenshots). Deleted with the placeholders.
 */
export const RIDE_PREVIEWS = ['connected', 'connecting', 'reconnecting', 'headset-missing'] as const;
export type RidePreview = (typeof RIDE_PREVIEWS)[number];

export function isRidePreview(value: unknown): value is RidePreview {
  return typeof value === 'string' && (RIDE_PREVIEWS as readonly string[]).includes(value);
}

/** Reads `?preview=` from a location search string ('' when there is none, e.g. on Android). */
export function previewFromSearch(search: string | undefined): RidePreview {
  const match = /[?&]preview=([\w-]+)/.exec(search ?? '');
  return isRidePreview(match?.[1]) ? match[1] : 'connected';
}

export function sampleSessionFor(preview: RidePreview): SessionSnapshot {
  switch (preview) {
    case 'connected':
      return SAMPLE_SESSION;
    case 'connecting':
      return { ...SAMPLE_SESSION, state: 'connecting', connectedAt: null };
    case 'reconnecting':
      return { ...SAMPLE_SESSION, state: 'reconnecting', attempt: 2 };
    case 'headset-missing':
      return { ...SAMPLE_SESSION, local: { ...SAMPLE_SESSION.local, headsetConnected: false } };
  }
}

const initialSearch =
  typeof globalThis === 'object' && 'location' in globalThis
    ? (globalThis as { location?: { search?: string } }).location?.search
    : undefined;

export const previewStore = createStore<{ preview: RidePreview; setPreview(p: RidePreview): void }>()(
  (set) => ({
    preview: previewFromSearch(initialSearch),
    setPreview: (preview) => set({ preview }),
  }),
);

/**
 * Web verification toggle: `?fontScale=1.3` emulates the system font scale (React Native Web ignores it), capped per
 * variant exactly like `maxFontSizeMultiplier` on Android. 1 everywhere else.
 */
export const webFontScale = (() => {
  const match = /[?&]fontScale=([\d.]+)/.exec(initialSearch ?? '');
  const value = match?.[1] ? Number(match[1]) : 1;
  return Number.isFinite(value) && value >= 1 && value <= 2 ? value : 1;
})();

/** M0 PLACEHOLDER: `?camera=denied` on web shows the guest screen's camera-denied state (screenshots). */
export const cameraPreviewDenied = /[?&]camera=denied\b/.test(initialSearch ?? '');
