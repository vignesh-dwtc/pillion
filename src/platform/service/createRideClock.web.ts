/**
 * Web twin of createRideClock: the browser's own timers (`systemClock`). There is no screen-off or Doze on web, so no
 * native Handler thread is needed. Web proves nothing about how the native ride clock behaves with the screen off.
 */
import { systemClock, type Clock } from '../../core/common/types';

export function createRideClock(): Clock {
  return systemClock;
}
