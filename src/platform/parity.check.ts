/**
 * Type-level parity check between each native factory module and its web twin (DECISIONS D-026). tsc only: nothing
 * here runs and nothing imports this file, so it never reaches a bundle.
 *
 * Why it exists: the shared `src/platform/<area>/index.ts` re-exports `createX` from `./createX`. TypeScript resolves
 * that to the NATIVE module, while Metro resolves `createX.web.ts` on web. The two files are never compared by the
 * compiler, so without this file a web twin could drift from the native signature and only fail in the browser.
 * Each assertion fails `npm run typecheck` when the exported factory types differ.
 *
 * Areas with a native sibling today: permissions, storage, crypto (written by `ui`), media and audio (`media`),
 * link and service (`android-native`).
 * `createKeyValueStore` has no web twin on purpose: react-native-mmkv ships its own web fallback.
 */
/* eslint-disable import/no-duplicates -- ESLint resolves a native module and its .web twin to the same file (platform
   extensions); importing both by explicit path is the whole point of this file. */
import type { createPermissionService as nativeCreatePermissionService } from './permissions/createPermissionService';
import type { createPermissionService as webCreatePermissionService } from './permissions/createPermissionService.web';
import type { createSecureStore as nativeCreateSecureStore } from './storage/createSecureStore';
import type { createSecureStore as webCreateSecureStore } from './storage/createSecureStore.web';
import type { createRandomBytesSource as nativeCreateRandomBytesSource } from './crypto/createRandomBytesSource';
import type { createRandomBytesSource as webCreateRandomBytesSource } from './crypto/createRandomBytesSource.web';
import type { createMediaEngine as nativeCreateMediaEngine } from './media/createMediaEngine';
import type { createMediaEngine as webCreateMediaEngine } from './media/createMediaEngine.web';
import type { createAudioRoute as nativeCreateAudioRoute } from './audio/createAudioRoute';
import type { createAudioRoute as webCreateAudioRoute } from './audio/createAudioRoute.web';
import type { createLinkTransport as nativeCreateLinkTransport } from './link/createLinkTransport';
import type { createLinkTransport as webCreateLinkTransport } from './link/createLinkTransport.web';
import type { createRideService as nativeCreateRideService } from './service/createRideService';
import type { createRideService as webCreateRideService } from './service/createRideService.web';

/** Strict type identity (not just mutual assignability). */
type Equals<A, B> = (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;
type Expect<T extends true> = T;

export type PermissionServiceParity = Expect<
  Equals<typeof nativeCreatePermissionService, typeof webCreatePermissionService>
>;
export type SecureStoreParity = Expect<Equals<typeof nativeCreateSecureStore, typeof webCreateSecureStore>>;
export type RandomBytesSourceParity = Expect<
  Equals<typeof nativeCreateRandomBytesSource, typeof webCreateRandomBytesSource>
>;
export type MediaEngineParity = Expect<Equals<typeof nativeCreateMediaEngine, typeof webCreateMediaEngine>>;
export type AudioRouteParity = Expect<Equals<typeof nativeCreateAudioRoute, typeof webCreateAudioRoute>>;
export type LinkTransportParity = Expect<
  Equals<typeof nativeCreateLinkTransport, typeof webCreateLinkTransport>
>;
export type RideServiceParity = Expect<Equals<typeof nativeCreateRideService, typeof webCreateRideService>>;
