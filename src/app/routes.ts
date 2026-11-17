/**
 * Route table. Pure TypeScript (no react-native / react-navigation imports) so the paths, test ids and the
 * start-up decision are unit-tested in Jest. The web deep-link paths and the `screen-*` test ids are what the
 * Playwright smoke test (`web-verify`) relies on: change them only together with that test.
 */

export type RootParamList = {
  Onboarding: undefined;
  Home: undefined;
  PairHost: undefined;
  PairGuest: undefined;
  Ride: undefined;
  Settings: undefined;
  Diagnostics: undefined;
  Debug: undefined;
};

export type RouteName = keyof RootParamList;

/** Linking path per route (no leading slash). */
export const ROUTE_PATHS: Record<RouteName, string> = {
  Onboarding: 'onboarding',
  Home: 'home',
  PairHost: 'pair/host',
  PairGuest: 'pair/guest',
  Ride: 'ride',
  Settings: 'settings',
  Diagnostics: 'diagnostics',
  Debug: 'debug',
};

/** testID on each screen's root view. */
export const SCREEN_TEST_IDS: Record<RouteName, string> = {
  Onboarding: 'screen-onboarding',
  Home: 'screen-home',
  PairHost: 'screen-pair-host',
  PairGuest: 'screen-pair-guest',
  Ride: 'screen-ride',
  Settings: 'screen-settings',
  Diagnostics: 'screen-diagnostics',
  Debug: 'screen-debug',
};

export const ROUTE_NAMES = Object.keys(ROUTE_PATHS) as RouteName[];

export interface StartupState {
  onboardingDone: boolean;
  hasPairing: boolean;
}

/** Where '/' (and a normal app launch) goes: onboarding only for a brand-new install, otherwise home. */
export function resolveInitialRoute(state: StartupState): 'Onboarding' | 'Home' {
  return !state.onboardingDone && !state.hasPairing ? 'Onboarding' : 'Home';
}

/** True for '/', '' and '/?query' or '/#hash' variants of the root path. */
export function isRootPath(path: string): boolean {
  const withoutQuery = path.split(/[?#]/, 1)[0] ?? '';
  return withoutQuery.replace(/\//g, '') === '';
}
