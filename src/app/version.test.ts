import type { ConfigContext } from 'expo/config';

import appConfig from '../../app.config';
import pkg from '../../package.json';

import { APP_VERSION } from './version';

describe('APP_VERSION', () => {
  it('is a semantic version', () => {
    expect(APP_VERSION).toMatch(/^\d+\.\d+\.\d+/);
  });

  it('matches package.json and the version in app.config.ts', () => {
    expect(APP_VERSION).toBe(pkg.version);
    const resolved = appConfig({ config: {} } as unknown as ConfigContext);
    expect(resolved.version).toBe(APP_VERSION);
  });
});
