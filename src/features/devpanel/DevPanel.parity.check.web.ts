/**
 * Type-level parity check for the dev panel: the web component and its native null twin must export the same
 * `DevPanel` type, because `src/app/App.tsx` is type-checked against the native file and bundled against the web one.
 * tsc only: nothing imports this file (see src/platform/parity.check.ts for the factory modules).
 */
/* eslint-disable import/no-duplicates -- ESLint resolves DevPanel and DevPanel.web to the same file (platform
   extensions); importing both by explicit path is the whole point of this file. */
import type { DevPanel as NativeDevPanel } from './DevPanel';
import type { DevPanel as WebDevPanel } from './DevPanel.web';

type Equals<A, B> = (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;
type Expect<T extends true> = T;

export type DevPanelParity = Expect<Equals<typeof NativeDevPanel, typeof WebDevPanel>>;
