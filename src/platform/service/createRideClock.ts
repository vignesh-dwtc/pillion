import { getIntercomRideServiceModule } from '../../../specs/IntercomRideService';
import { systemClock, type Clock } from '../../core/common/types';
import { createNativeRideClock, hasRideTimers } from './NativeRideClock';

let shared: Clock | null = null;

/**
 * Native ride clock factory: timers on a native Handler thread (see NativeRideClock.ts), so heartbeats, watchdog,
 * reconnect backoff and the link's open timeout keep running with the screen off. One process-wide instance (one native
 * event subscription), shared by the session and the LAN transport. Falls back to `systemClock` when the
 * IntercomRideService module is not linked or predates the timer functions. On web the twin returns `systemClock`.
 *
 * Compiles and is unit-tested with a fake native module (NativeRideClock.test.ts); untested on device.
 */
export function createRideClock(): Clock {
  if (shared !== null) return shared;
  const native: unknown = getIntercomRideServiceModule();
  shared = hasRideTimers(native) ? createNativeRideClock(native) : systemClock;
  return shared;
}
