import { useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { AppState as RNAppState, Platform } from 'react-native';
import { useStore } from 'zustand';

import type { DiagnosticsReportInput, LogEntry, StatsSample } from '../core/diagnostics/types';
import type { SessionSnapshot } from '../core/session/types';
import type { AudioRouteState } from '../platform/audio/AudioRoute';
import type { LinkKind, LinkNetworkInterface } from '../platform/link/LinkTransport';
import type { BatteryInfo } from '../platform/service/RideService';

import { appStore, ringLog, rideRuntime } from './composition';
import type { RideStartProblem } from './ride';
import type { AppState } from './store';
import { APP_VERSION } from './version';

/** Selects from the app store. Select primitives or stable references: a selector that builds a new object re-renders on every change. */
export function useAppStore<T>(selector: (state: AppState) => T): T {
  return useStore(appStore, selector);
}

/** The live session snapshot published by the SessionController (idle before the first ride). */
export function useSessionSnapshot(): SessionSnapshot {
  return useStore(rideRuntime.store, (s) => s.snapshot);
}

/** The latest one-second media sample (rtt, jitter, loss, bitrate, levels); null without a media session. */
export function useRideSample(): StatsSample | null {
  return useStore(rideRuntime.store, (s) => s.sample);
}

/** When the current (or last) ride first connected: the ride clock, which keeps running through reconnects. */
export function useRideStartedAt(): number | null {
  return useStore(rideRuntime.store, (s) => s.rideStartedAt);
}

/** The ride's link kind, known as soon as the ride starts. */
export function useRideLinkKind(): LinkKind | null {
  return useStore(rideRuntime.store, (s) => s.linkKind);
}

export function useRideStartProblem(): RideStartProblem | null {
  return useStore(rideRuntime.store, (s) => s.startProblem);
}

/** Wall clock for the ride timer, ticking once per second while `active` (a text change, not an animation). */
export function useRideClock(active: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [active]);
  return now;
}

/** Audio route state, following AudioRoute.onChange; re-read when the app returns to the foreground. */
export function useAudioRoute(): AudioRouteState | null {
  useEffect(() => {
    void rideRuntime.refreshAudio();
    const subscription = RNAppState.addEventListener('change', (state) => {
      if (state === 'active') void rideRuntime.refreshAudio();
    });
    return () => subscription.remove();
  }, []);
  return useStore(rideRuntime.store, (s) => s.audio);
}

/** The ring log's entries, refreshed on every (rate-limited) append. */
export function useRingLog(): LogEntry[] {
  return useSyncExternalStore(ringLogEntries.subscribe, ringLogEntries.get, ringLogEntries.get);
}

/** A stable snapshot of the ring log for useSyncExternalStore: re-read only after an append was notified. */
const ringLogEntries = (() => {
  let cache: LogEntry[] | null = null;
  return {
    get: (): LogEntry[] => (cache ??= ringLog.entries()),
    subscribe: (listener: () => void) =>
      ringLog.subscribe(() => {
        cache = null;
        listener();
      }),
  };
})();

/** Polls an async source every `intervalMs` while mounted. */
function usePolled<T>(source: () => Promise<T>, intervalMs: number, initial: T): T {
  const [value, setValue] = useState<T>(initial);
  useEffect(() => {
    let cancelled = false;
    const poll = () => {
      source().then(
        (next) => {
          if (!cancelled) setValue(next);
        },
        () => undefined,
      );
    };
    poll();
    const timer = setInterval(poll, intervalMs);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [source, intervalMs]);
  return value;
}

const listInterfaces = () => rideRuntime.listInterfaces();
const getBattery = () => rideRuntime.getBattery();
const NO_INTERFACES: LinkNetworkInterface[] = [];

function platformInfo(): Pick<DiagnosticsReportInput, 'platform' | 'osVersion' | 'deviceModel'> {
  const constants = (Platform as { constants?: { Model?: unknown; Manufacturer?: unknown } }).constants;
  const model = typeof constants?.Model === 'string' ? constants.Model : null;
  const maker = typeof constants?.Manufacturer === 'string' ? constants.Manufacturer : null;
  return {
    platform: Platform.OS,
    osVersion: Platform.OS === 'web' ? null : String(Platform.Version),
    deviceModel: model ? (maker ? `${maker} ${model}` : model) : null,
  };
}

const PLATFORM_INFO = platformInfo();

/**
 * Everything the diagnostics screen and its share export show, assembled from the live sources: session snapshot,
 * media stats and the one-second sample, audio route, local interfaces (every 5 s), battery (every 10 s), tunables
 * and the ring log. Contains no secret: the contract types cannot carry one.
 */
export function useDiagnosticsInput(): DiagnosticsReportInput {
  const session = useSessionSnapshot();
  const stats = useStore(rideRuntime.store, (s) => s.stats);
  const sample = useRideSample();
  const audio = useAudioRoute();
  const tunables = useAppStore((s) => s.tunables);
  const log = useRingLog();
  const interfaces = usePolled(listInterfaces, 5_000, NO_INTERFACES);
  const battery = usePolled<BatteryInfo | null>(getBattery, 10_000, null);
  const generatedAt = useRideClock(true);

  return useMemo(
    () => ({
      generatedAt,
      appVersion: APP_VERSION,
      ...PLATFORM_INFO,
      session,
      interfaces,
      stats,
      sample,
      audio,
      battery,
      tunables,
      log,
    }),
    [generatedAt, session, interfaces, stats, sample, audio, battery, tunables, log],
  );
}
