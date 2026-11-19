import { Platform } from 'react-native';
import { requireOptionalNativeModule } from 'expo';

/**
 * Bridge to the Android Auto part of the app (android/ in this folder).
 * The car screen runs natively and can be opened while the phone app is
 * closed, so the app hands it the latest battery, range and position here.
 * Does nothing on iOS and the web.
 */
export interface CarState {
  /** battery % */
  battery: number;
  /** battery % above the reserve (ring colour) */
  usable: number;
  rangeKm: number;
  /** kWh/100 km */
  consumption: number;
  capacityKwh: number;
  /** a drive is running */
  driving: boolean;
  /** reserve in % (0 = off) */
  reserve: number;
  /** battery % is read live from the car */
  obd: boolean;
  lat: number | null;
  lon: number | null;
  /** time of the position (ms) */
  fixTs: number | null;
  /** when this state was written (ms) */
  ts: number;
  /** Open Charge Map key */
  ocmKey: string;
}

const native =
  Platform.OS === 'android'
    ? requireOptionalNativeModule<{ setState(json: string): void; takeReserve?(): number }>('RangePilotCar')
    : null;

export const carScreenAvailable = !!native;

export function setCarState(state: CarState): void {
  try {
    native?.setState(JSON.stringify(state));
  } catch {
    // older build without the car part
  }
}

/** Reserve % chosen on the car screen since the last call, or null. */
export function takeCarReserve(): number | null {
  try {
    const v = native?.takeReserve?.();
    return typeof v === 'number' && v >= 0 ? v : null;
  } catch {
    return null;
  }
}
