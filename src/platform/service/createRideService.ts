import { getIntercomRideServiceModule } from '../../../specs/IntercomRideService';
import { createNativeRideService, RideServiceError } from './NativeRideService';
import type { RideService } from './RideService';

/**
 * Native RideService factory over the IntercomRideService module. When the module is not linked, start() rejects
 * (ERR_NOT_IMPLEMENTED) and everything else is inert. The web twin (`createRideService.web.ts`, owned by `web-verify`)
 * is a fake.
 *
 * Compiles and is unit-tested with a fake native module (NativeRideService.test.ts); untested on device.
 */
export function createRideService(): RideService {
  const native = getIntercomRideServiceModule();
  if (native !== null) return createNativeRideService(native);
  return {
    start: () =>
      Promise.reject(
        new RideServiceError('ERR_NOT_IMPLEMENTED', 'the IntercomRideService native module is not linked'),
      ),
    update: () => Promise.resolve(),
    stop: () => Promise.resolve(),
    isRunning: () => Promise.resolve(false),
    onAction: () => () => undefined,
    getBattery: () => Promise.resolve(null),
  };
}
