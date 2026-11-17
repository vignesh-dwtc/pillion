import { useStore } from 'zustand';

import type { DiagnosticsReportInput } from '../core/diagnostics/types';
import type { SessionSnapshot } from '../core/session/types';
import type { AudioRouteState } from '../platform/audio/AudioRoute';

import { appStore } from './composition';
import { SAMPLE_AUDIO, SAMPLE_DIAGNOSTICS, SAMPLE_SESSION } from './placeholders';
import type { AppState } from './store';

/** Selects from the app store. Select primitives or stable references: a selector that builds a new object re-renders on every change. */
export function useAppStore<T>(selector: (state: AppState) => T): T {
  return useStore(appStore, selector);
}

/**
 * M0 PLACEHOLDER: the screens read the session through this hook, which returns a static sample. In M1 it
 * subscribes to the `SessionController` from the composition root, and nothing in the screens changes.
 */
export function useSessionSnapshot(): SessionSnapshot {
  return SAMPLE_SESSION;
}

/** M0 PLACEHOLDER: static sample audio route; M1 subscribes to `AudioRoute.onChange`. */
export function useAudioRoute(): AudioRouteState {
  return SAMPLE_AUDIO;
}

/** M0 PLACEHOLDER: static sample report input; M1 assembles it from the live sources. */
export function useDiagnosticsInput(): DiagnosticsReportInput {
  return SAMPLE_DIAGNOSTICS;
}
