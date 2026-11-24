/**
 * Type-level parity check for the QR scanner: the native component (expo-camera) and its web twin must export the
 * same names and types, because the guest screen is type-checked against the native file and bundled against the
 * web one on web. tsc only: nothing imports this file.
 */
/* eslint-disable import/no-duplicates -- ESLint resolves QrScanner and QrScanner.web to the same file (platform
   extensions); importing both by explicit path is the whole point of this file. */
import type { CAMERA_SCANNING_AVAILABLE as NativeAvailable, QrScanner as NativeQrScanner } from './QrScanner';
import type { CAMERA_SCANNING_AVAILABLE as WebAvailable, QrScanner as WebQrScanner } from './QrScanner.web';

type Equals<A, B> = (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;
type Expect<T extends true> = T;

export type QrScannerParity = Expect<Equals<typeof NativeQrScanner, typeof WebQrScanner>>;
export type ScanningFlagParity = Expect<Equals<typeof NativeAvailable, typeof WebAvailable>>;
