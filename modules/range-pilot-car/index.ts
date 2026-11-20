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
  /** consumption the "Can I make it?" estimate plans with */
  planConsumption: number;
  googleKey: string;
  /** destinations used before, newest first */
  recents: { name: string; address: string; lat: number; lon: number }[];
  /** destination of the running drive, with the estimate the phone shows */
  dest: {
    name: string;
    address: string;
    lat: number;
    lon: number;
    remainingKm: number;
    minutes: number;
    arrivalPct: number;
    status: 'ok' | 'tight' | 'no';
  } | null;
}

/** A destination picked on the car screen (route already calculated there), or a request to clear it. */
export type CarDestination =
  | { clear: true }
  | {
      clear?: false;
      name: string;
      address: string;
      lat: number;
      lon: number;
      routeKm: number;
      minutes: number;
      netM: number;
      climbM: number;
      descentM: number;
    };

const native =
  Platform.OS === 'android'
    ? requireOptionalNativeModule<{ setState(json: string): void; takeReserve?(): number;
        takeDestination?(): string;
        bubbleAllowed?(): boolean;
        openBubblePermission?(): void;
        showBubble?(): void;
        hideBubble?(): void;
      }>('RangePilotCar')
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

/** Destination picked or cleared on the car screen since the last call, or null. */
export function takeCarDestination(): CarDestination | null {
  try {
    const raw = native?.takeDestination?.();
    if (!raw) return null;
    const d = JSON.parse(raw);
    if (d?.clear) return { clear: true };
    if (typeof d?.lat !== 'number' || typeof d?.lon !== 'number' || typeof d?.routeKm !== 'number') return null;
    return d as CarDestination;
  } catch {
    return null;
  }
}

// ---- floating range bubble over other apps (Android) ----

export const bubbleAvailable = !!native?.showBubble;

/** The user has allowed "display over other apps" for Range Pilot. */
export function bubbleAllowed(): boolean {
  try {
    return !!native?.bubbleAllowed?.();
  } catch {
    return false;
  }
}

/** Opens the system screen where the user allows it. */
export function openBubblePermission(): void {
  try {
    native?.openBubblePermission?.();
  } catch {}
}

export function showBubble(): void {
  try {
    native?.showBubble?.();
  } catch {}
}

export function hideBubble(): void {
  try {
    native?.hideBubble?.();
  } catch {}
}
