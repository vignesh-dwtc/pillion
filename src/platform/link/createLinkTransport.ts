import IDENTITY from '../../../config/identity.json';
import { getIntercomLinkModule } from '../../../specs/IntercomLink';
import { createRideClock } from '../service/createRideClock';
import { createLanTransport } from './LanTransport';
import { LinkError, type LinkTransport } from './LinkTransport';

/**
 * Native LinkTransport factory: LanTransport (NSD + TCP) over the IntercomLink module, with the NSD service type from
 * config/identity.json and the native ride clock (its open timeout must run with the screen off). When the native
 * module is not linked (a build without modules/intercom-native) it returns a transport that is never available. The web twin (`createLinkTransport.web.ts`, owned by `web-verify`) is the dev relay.
 *
 * Compiles and is unit-tested with a fake native module (LanTransport.test.ts); untested on device.
 */
export function createLinkTransport(): LinkTransport {
  const native = getIntercomLinkModule();
  if (native === null) return unlinkedTransport();
  return createLanTransport(native, { serviceType: IDENTITY.nsdServiceType, clock: createRideClock() });
}

function unlinkedTransport(): LinkTransport {
  return {
    kind: 'lan',
    isAvailable: () => Promise.resolve(false),
    open: () => Promise.reject(new LinkError('unsupported', 'the IntercomLink native module is not linked')),
    listInterfaces: () => Promise.resolve([]),
    dispose: () => Promise.resolve(),
  };
}
