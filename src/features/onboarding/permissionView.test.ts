import type { PermissionState } from '../../platform/permissions/PermissionService';

import { PERMISSION_ICONS, PERMISSION_KEYS, describePermissionState } from './permissionView';

const STATES: PermissionState[] = ['granted', 'denied', 'blocked', 'undetermined', 'unavailable'];

describe('describePermissionState', () => {
  it('spells out every state in words', () => {
    const labels = STATES.map((s) => describePermissionState(s).label);
    expect(new Set(labels).size).toBe(STATES.length);
    for (const label of labels) expect(label.length).toBeGreaterThan(3);
  });

  it('offers Allow when it can be asked, Open settings when blocked, nothing otherwise', () => {
    expect(describePermissionState('undetermined').action).toBe('allow');
    expect(describePermissionState('denied').action).toBe('allow');
    expect(describePermissionState('blocked').action).toBe('open-settings');
    expect(describePermissionState('granted').action).toBeNull();
    expect(describePermissionState('unavailable').action).toBeNull();
  });

  it('marks granted as success and blocked as danger', () => {
    expect(describePermissionState('granted').tone).toBe('success');
    expect(describePermissionState('blocked').tone).toBe('danger');
  });
});

describe('permission list', () => {
  it('explains all four permissions, each with an icon', () => {
    expect([...PERMISSION_KEYS].sort()).toEqual([
      'bluetooth',
      'microphone',
      'nearbyDevices',
      'notifications',
    ]);
    for (const key of PERMISSION_KEYS) expect(PERMISSION_ICONS[key]).toBeTruthy();
  });
});
