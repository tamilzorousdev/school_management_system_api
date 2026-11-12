export type CallSide = 'staff' | 'parent';

export interface DeviceApp {
  fcm_token: string;
  app: string | null;
}

const NEUTRAL_APPS = [null, 'mobile'];

export function devicesForSide<T extends DeviceApp>(devices: T[], side: CallSide): T[] {
  const matching = devices.filter((device) => device.app === side);
  if (matching.length) return matching;
  const otherSide = devices.some((device) => !NEUTRAL_APPS.includes(device.app) && device.app !== side);
  if (otherSide) return [];
  return devices.filter((device) => NEUTRAL_APPS.includes(device.app));
}
