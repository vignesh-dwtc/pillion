import { ROUTE_NAMES, ROUTE_PATHS, SCREEN_TEST_IDS, isRootPath, resolveInitialRoute } from './routes';

describe('route table', () => {
  it('exposes exactly the paths the web smoke test depends on', () => {
    expect(
      Object.values(ROUTE_PATHS)
        .map((p) => `/${p}`)
        .sort(),
    ).toEqual(
      [
        '/onboarding',
        '/home',
        '/pair/host',
        '/pair/guest',
        '/ride',
        '/settings',
        '/diagnostics',
        '/debug',
      ].sort(),
    );
  });

  it('has the stable screen test ids', () => {
    expect(Object.values(SCREEN_TEST_IDS).sort()).toEqual(
      [
        'screen-onboarding',
        'screen-home',
        'screen-pair-host',
        'screen-pair-guest',
        'screen-ride',
        'screen-settings',
        'screen-diagnostics',
        'screen-debug',
      ].sort(),
    );
  });

  it('keeps routes, paths and test ids in step', () => {
    expect([...ROUTE_NAMES].sort()).toEqual(Object.keys(SCREEN_TEST_IDS).sort());
  });
});

describe('resolveInitialRoute', () => {
  it('sends a brand-new install to onboarding', () => {
    expect(resolveInitialRoute({ onboardingDone: false, hasPairing: false })).toBe('Onboarding');
  });

  it('goes home once onboarding is done', () => {
    expect(resolveInitialRoute({ onboardingDone: true, hasPairing: false })).toBe('Home');
  });

  it('goes home when a pairing already exists even if onboarding was never completed', () => {
    expect(resolveInitialRoute({ onboardingDone: false, hasPairing: true })).toBe('Home');
  });

  it('goes home when both are true', () => {
    expect(resolveInitialRoute({ onboardingDone: true, hasPairing: true })).toBe('Home');
  });
});

describe('isRootPath', () => {
  it('recognises the root in its usual spellings', () => {
    for (const path of ['/', '', '//', '/?utm=1', '/#top', '?x=1']) expect(isRootPath(path)).toBe(true);
  });

  it('does not treat real routes as the root', () => {
    for (const path of ['/home', '/pair/host', 'ride', '/debug?x=1']) expect(isRootPath(path)).toBe(false);
  });
});
