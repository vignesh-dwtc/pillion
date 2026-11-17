import pkg from '../../package.json';

/**
 * App version shown on the settings screen. Read from package.json (the single source in JS); `app.config.ts`
 * carries the same number for the native build, and `version.test.ts` fails if the two drift apart.
 */
export const APP_VERSION: string = pkg.version;
