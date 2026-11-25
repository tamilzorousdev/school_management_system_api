import { parseOneSignalApps, parsePairs } from '../../config/configuration';
import { pushTargets } from './notifications.service';
import { UserDevice } from '../users/entities/user-device.entity';

const device = (token: string, oneSignalAppId: string | null): UserDevice =>
  ({ fcm_token: token, onesignal_app_id: oneSignalAppId }) as UserDevice;

describe('parseOneSignalApps', () => {
  it('reads a comma separated list of app id and rest key pairs', () => {
    expect(parseOneSignalApps('a1:k1,a2:k2')).toEqual({ a1: 'k1', a2: 'k2' });
  });

  it('trims whitespace and ignores incomplete pairs', () => {
    expect(parseOneSignalApps(' a1 : k1 , broken , :k2 , a3: ')).toEqual({ a1: 'k1' });
  });

  it('is empty when unset', () => {
    expect(parseOneSignalApps(undefined)).toEqual({});
    expect(parseOneSignalApps('')).toEqual({});
  });
});

describe('pushTargets', () => {
  it('carries each device OneSignal app alongside its token', () => {
    expect(pushTargets([device('t1', 'app-a'), device('t2', 'app-b')])).toEqual([
      { token: 't1', oneSignalAppId: 'app-a' },
      { token: 't2', oneSignalAppId: 'app-b' },
    ]);
  });

  it('leaves an unregistered app null so the default is used', () => {
    expect(pushTargets([device('t1', null)])).toEqual([{ token: 't1', oneSignalAppId: null }]);
  });
});

describe('parsePairs', () => {
  it('keeps a value that itself contains a colon', () => {
    expect(parsePairs('a1:k:1,a2:k2')).toEqual({ a1: 'k:1', a2: 'k2' });
  });

  it('maps a OneSignal app id to the tenant that owns it', () => {
    expect(parsePairs('637c058f:TZSMS_DRIVER,c066ba63:TZSMS_OFFICE')).toEqual({
      '637c058f': 'TZSMS_DRIVER',
      c066ba63: 'TZSMS_OFFICE',
    });
  });
});
