import { devicesForSide } from './call-devices';

const device = (fcm_token: string, app: string | null) => ({ fcm_token, app });

describe('call ring devices', () => {
  it('rings only the phones registered for the side being called', () => {
    const devices = [device('staff-phone', 'staff'), device('parent-phone', 'parent')];
    expect(devicesForSide(devices, 'parent').map((item) => item.fcm_token)).toEqual(['parent-phone']);
    expect(devicesForSide(devices, 'staff').map((item) => item.fcm_token)).toEqual(['staff-phone']);
  });

  it('never rings a phone that is signed in as the other side', () => {
    expect(devicesForSide([device('staff-phone', 'staff')], 'parent')).toEqual([]);
    expect(devicesForSide([device('staff-phone', 'staff'), device('old', null)], 'parent')).toEqual([]);
  });

  it('uses phones without a side only when nothing points to the other side', () => {
    expect(
      devicesForSide([device('old', null), device('generic', 'mobile')], 'parent').map((item) => item.fcm_token),
    ).toEqual(['old', 'generic']);
    expect(devicesForSide([], 'staff')).toEqual([]);
  });
});
