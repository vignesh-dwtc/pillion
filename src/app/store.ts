import { createStore, type StoreApi } from 'zustand/vanilla';

import type { PairingRecord, PairingRepository } from '../core/pairing/types';
import { DEFAULT_AUDIO_TUNABLES, type AudioTunables } from '../platform/audio/AudioTunables';
import type { KeyValueStore } from '../platform/storage/stores';

import {
  defaultSettings,
  loadSettings,
  loadTunables,
  sanitizeDeviceName,
  sanitizeTunables,
  saveSettings,
  saveTunables,
  tunablesEqual,
  type AppSettings,
} from './persistence';

/**
 * The app's Zustand store: persisted settings, the audio-tunables editing state and the list of pairings.
 * Built from injected ports (`createAppStore`) so Jest can drive it with in-memory fakes; the real instance is
 * created in `composition.ts`. The store never holds a pairing secret or Wi-Fi passphrase: it keeps a summary,
 * and the session start path reads the full record from the repository by pairId.
 */

/** What the UI may know about a pairing. Deliberately has no secret and no Wi-Fi credentials. */
export interface PairingSummary {
  pairId: string;
  role: PairingRecord['role'];
  partnerName: string | null;
  createdAt: number;
}

export function summarizePairing(record: PairingRecord): PairingSummary {
  return {
    pairId: record.pairId,
    role: record.role,
    partnerName: record.partnerName,
    createdAt: record.createdAt,
  };
}

export type PairingsStatus = 'loading' | 'ready' | 'error';

export interface AppState extends AppSettings {
  /** Live audio tunables: edited on the debug screen, persisted, and pushed to the media engine in M1. */
  tunables: AudioTunables;
  pairings: PairingSummary[];
  pairingsStatus: PairingsStatus;

  setDeviceName(name: string): void;
  setDeveloperMode(enabled: boolean): void;
  setAllowNoHeadset(allow: boolean): void;
  completeOnboarding(): void;
  /** Merges a partial change (validated against AUDIO_TUNABLE_LIMITS), persists it and notifies the listener. */
  setTunables(patch: Partial<AudioTunables>): void;
  resetTunables(): void;
  refreshPairings(): Promise<void>;
  removePairing(pairId: string): Promise<void>;
}

export interface AppStoreDeps {
  kv: KeyValueStore;
  pairings: PairingRepository;
  /** Display name used until the user picks one. */
  defaultDeviceName: string;
  /** M1: the composition root passes `media.setTunables` here so edits apply live during a ride. */
  onTunablesChanged?: (tunables: AudioTunables) => void;
}

export type AppStore = StoreApi<AppState>;

/** The override that actually applies: it needs developer mode, whatever was stored. */
export function selectAllowNoHeadset(state: Pick<AppState, 'developerMode' | 'allowNoHeadset'>): boolean {
  return state.developerMode && state.allowNoHeadset;
}

export function createAppStore(deps: AppStoreDeps): AppStore {
  const { kv } = deps;
  const defaults = defaultSettings(deps.defaultDeviceName);
  const initialSettings = loadSettings(kv, defaults);

  return createStore<AppState>()((set, get) => {
    const persistSettings = (): void => {
      const { deviceName, developerMode, allowNoHeadset, onboardingDone } = get();
      saveSettings(kv, { deviceName, developerMode, allowNoHeadset, onboardingDone });
    };

    const applyTunables = (next: AudioTunables): void => {
      if (tunablesEqual(get().tunables, next)) return;
      set({ tunables: next });
      saveTunables(kv, next);
      deps.onTunablesChanged?.(next);
    };

    return {
      ...initialSettings,
      tunables: loadTunables(kv),
      pairings: [],
      pairingsStatus: 'loading',

      setDeviceName(name) {
        set({ deviceName: sanitizeDeviceName(name, defaults.deviceName) });
        persistSettings();
      },

      setDeveloperMode(enabled) {
        // Leaving developer mode also clears the overrides, so nothing stays active that the user cannot see.
        set(enabled ? { developerMode: true } : { developerMode: false, allowNoHeadset: false });
        persistSettings();
      },

      setAllowNoHeadset(allow) {
        if (!get().developerMode) return;
        set({ allowNoHeadset: allow });
        persistSettings();
      },

      completeOnboarding() {
        set({ onboardingDone: true });
        persistSettings();
      },

      setTunables(patch) {
        applyTunables(sanitizeTunables({ ...get().tunables, ...patch }));
      },

      resetTunables() {
        applyTunables({ ...DEFAULT_AUDIO_TUNABLES });
      },

      async refreshPairings() {
        try {
          const records = await deps.pairings.list();
          set({ pairings: records.map(summarizePairing), pairingsStatus: 'ready' });
        } catch {
          // Keep what we had. The error is not logged here: it may come from a layer that handled secret data.
          set({ pairingsStatus: 'error' });
        }
      },

      async removePairing(pairId) {
        await deps.pairings.remove(pairId);
        await get().refreshPairings();
      },
    };
  });
}
