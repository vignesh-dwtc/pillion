import type { PermissionStatus } from '../platform/permissions/PermissionService';

import { canStartRide, planRidePermissions } from './ridePermissions';

const status = (overrides: Partial<PermissionStatus>): PermissionStatus => ({
  microphone: 'granted',
  notifications: 'granted',
  bluetooth: 'granted',
  nearbyDevices: 'granted',
  ...overrides,
});

describe('ride permission plan', () => {
  it('starts straight away when everything is granted or not applicable', () => {
    expect(planRidePermissions(status({}), false).explain).toEqual([]);
    expect(
      planRidePermissions(status({ microphone: 'unavailable', bluetooth: 'unavailable' }), false).explain,
    ).toEqual([]);
  });

  it('explains microphone, notifications and Bluetooth in that order before asking', () => {
    const plan = planRidePermissions(
      status({ microphone: 'undetermined', notifications: 'undetermined', bluetooth: 'denied' }),
      false,
    );
    expect(plan.explain).toEqual(['microphone', 'notifications', 'bluetooth']);
    expect(plan.askable).toEqual(['microphone', 'notifications', 'bluetooth']);
    expect(plan.blocked).toEqual([]);
  });

  it('never blocks on notifications once they were answered', () => {
    expect(planRidePermissions(status({ notifications: 'denied' }), false).explain).toEqual([]);
    expect(planRidePermissions(status({ notifications: 'blocked' }), false).explain).toEqual([]);
  });

  it('does not need Bluetooth with the earpiece/speaker override', () => {
    expect(planRidePermissions(status({ bluetooth: 'blocked' }), true).explain).toEqual([]);
    expect(canStartRide(status({ bluetooth: 'blocked' }), true)).toBe(true);
    expect(canStartRide(status({ bluetooth: 'blocked' }), false)).toBe(false);
  });

  it('separates what the system can still ask from what only settings can change', () => {
    const plan = planRidePermissions(status({ microphone: 'blocked', bluetooth: 'undetermined' }), false);
    expect(plan.blocked).toEqual(['microphone']);
    expect(plan.askable).toEqual(['bluetooth']);
    expect(canStartRide(status({ microphone: 'denied' }), false)).toBe(false);
  });
});
