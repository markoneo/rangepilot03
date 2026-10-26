import { kv } from './kv';

// Range Pilot keeps everything on the device (no accounts, no server).
// All persistence goes through kv (AsyncStorage on native, localStorage on web).
const storage = kv;

/** Storage key for modules that keep their own data. */
export function userKey(key: string): string {
  return key;
}

function k(key: string): string {
  return key;
}

export interface CarSettings {
  carName: string;
  batteryCapacity: number;
}

export interface AppState {
  consumption: number;
  batteryPercentage: number;
  preset: 'city' | 'mixed' | 'highway' | 'avg' | 'custom';
}

export interface TripRecord {
  id: string;
  startedAt: string;
  endedAt: string;
  distanceKm: number;
  durationSeconds: number;
  startBattery: number;
  endBattery: number;
  consumption: number;
  realConsumption: number | null;
  carName: string;
  batteryCapacity: number;
  minElevationM?: number | null;
  maxElevationM?: number | null;
  minTemperatureC?: number | null;
  maxTemperatureC?: number | null;
  minSpeedKmh?: number | null;
  maxSpeedKmh?: number | null;
  speedSamples?: SpeedSample[] | null;
  title?: string;
  /** Extra stats (stored in the `stats` jsonb column in the cloud). */
  movingSeconds?: number | null;
  elevationGainM?: number | null;
  elevationLossM?: number | null;
  /** km that were reconstructed across GPS gaps (tunnels / background). */
  estimatedKm?: number | null;
  gpsGaps?: number | null;
  reservePercent?: number | null;
  rangeAtEndKm?: number | null;
  /** Electricity price snapshot at the time of the trip (per kWh). */
  pricePerKwh?: number | null;
  /** where the price came from: logged charges or the fixed price in Settings */
  priceSource?: 'charges' | 'settings' | null;
  currency?: string | null;
}

export interface UserPrefs {
  /** Price per kWh, used for trip cost. null = don't show cost. */
  electricityPrice: number | null;
  currency: string;
  /** Default "arrive with" reserve in % (0 = off). */
  defaultReserve: number;
}

export const DEFAULT_PREFS: UserPrefs = {
  electricityPrice: null,
  currency: '€',
  defaultReserve: 10,
};

export interface SpeedSample {
  t: number;
  s: number;
}

const KEYS = {
  CAR_SETTINGS: 'ev_car_settings',
  APP_STATE: 'ev_app_state',
  TRIPS: 'ev_trips',
  ACTIVE_SESSION: 'ev_active_session',
  PREFS: 'ev_prefs',
} as const;

/** Kept for compatibility; data is always local now. */
export async function ensureUserLoaded(): Promise<void> {}

export async function loadPrefs(): Promise<UserPrefs> {
  const raw = await storage.getItem(k(KEYS.PREFS));
  if (!raw) return { ...DEFAULT_PREFS };
  try {
    return { ...DEFAULT_PREFS, ...JSON.parse(raw) };
  } catch {
    return { ...DEFAULT_PREFS };
  }
}

export async function savePrefs(p: UserPrefs): Promise<void> {
  await storage.setItem(k(KEYS.PREFS), JSON.stringify(p));
}

export function tripEnergyKwh(t: TripRecord): number {
  return Math.max(0, (t.batteryCapacity * (t.startBattery - t.endBattery)) / 100);
}

export function tripConsumption(t: TripRecord): number {
  return t.realConsumption ?? t.consumption;
}

/**
 * Key for the active trip (tripTracker.ts). Deliberately NOT namespaced by
 * user: the background task can run before auth has loaded, and a device only
 * ever has one drive in progress.
 */
export function activeTripKey(): string {
  return 'ev_active_trip_v2';
}

export interface ActiveDriveSession {
  id: string;
  startedAt: string;
  updatedAt: string;
  phase: 'driving' | 'paused';
  carName: string;
  batteryCapacity: number;
  startBattery: number;
  currentBattery: number;
  batteryAnchor: number;
  batteryAnchorDistance: number;
  distanceKm: number;
  elapsedSeconds: number;
  consumption: number;
  reserveEnabled: boolean;
  targetBattery: number;
  minElevationM: number | null;
  maxElevationM: number | null;
  minTemperatureC: number | null;
  maxTemperatureC: number | null;
  minSpeedKmh: number | null;
  maxSpeedKmh: number | null;
  lastCoordLat: number | null;
  lastCoordLon: number | null;
  lastSpeedKmh: number;
}

export async function saveActiveSession(session: ActiveDriveSession): Promise<void> {
  await storage.setItem(k(KEYS.ACTIVE_SESSION), JSON.stringify(session));
}

export async function loadActiveSession(): Promise<ActiveDriveSession | null> {
  const data = await storage.getItem(k(KEYS.ACTIVE_SESSION));
  if (!data) return null;
  try {
    return JSON.parse(data);
  } catch {
    return null;
  }
}

export async function clearActiveSession(): Promise<void> {
  await storage.setItem(k(KEYS.ACTIVE_SESSION), '');
}

export async function saveCarSettings(settings: CarSettings): Promise<void> {
  await storage.setItem(k(KEYS.CAR_SETTINGS), JSON.stringify(settings));
}

export async function loadCarSettings(): Promise<CarSettings | null> {
  const data = await storage.getItem(k(KEYS.CAR_SETTINGS));
  if (!data) return null;
  try {
    return JSON.parse(data);
  } catch {
    return null;
  }
}

export async function saveAppState(state: AppState): Promise<void> {
  await storage.setItem(k(KEYS.APP_STATE), JSON.stringify(state));
}

export async function loadAppState(): Promise<AppState | null> {
  const data = await storage.getItem(k(KEYS.APP_STATE));
  if (!data) return null;
  try {
    return JSON.parse(data);
  } catch {
    return null;
  }
}

/** Convert an old cloud row (used once when moving data to the device). */
export function rowToTrip(r: any): TripRecord {
  const st = r.stats && typeof r.stats === 'object' ? r.stats : {};
  const num = (v: any) => (v != null && isFinite(Number(v)) ? Number(v) : null);
  return {
    id: r.id,
    startedAt: r.started_at,
    endedAt: r.ended_at,
    distanceKm: Number(r.distance_km),
    durationSeconds: Number(r.duration_seconds),
    startBattery: Number(r.start_battery),
    endBattery: Number(r.end_battery),
    consumption: Number(r.consumption),
    realConsumption: num(r.real_consumption),
    carName: r.car_name,
    batteryCapacity: Number(r.battery_capacity),
    minElevationM: num(r.min_elevation_m),
    maxElevationM: num(r.max_elevation_m),
    minTemperatureC: num(r.min_temperature_c),
    maxTemperatureC: num(r.max_temperature_c),
    minSpeedKmh: num(r.min_speed_kmh),
    maxSpeedKmh: num(r.max_speed_kmh),
    speedSamples: Array.isArray(r.speed_samples) ? r.speed_samples : null,
    title: r.title ?? undefined,
    movingSeconds: num(st.movingSeconds),
    elevationGainM: num(st.elevationGainM),
    elevationLossM: num(st.elevationLossM),
    estimatedKm: num(st.estimatedKm),
    gpsGaps: num(st.gpsGaps),
    reservePercent: num(st.reservePercent),
    rangeAtEndKm: num(st.rangeAtEndKm),
    pricePerKwh: num(st.pricePerKwh),
    priceSource: st.priceSource ?? null,
    currency: st.currency ?? null,
  };
}

async function readLocalTrips(): Promise<TripRecord[]> {
  const raw = await storage.getItem(k(KEYS.TRIPS));
  if (!raw) return [];
  try {
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}

export async function saveTrip(trip: TripRecord): Promise<void> {
  const existing = await readLocalTrips();
  const updated = [trip, ...existing.filter((t) => t.id !== trip.id)];
  await storage.setItem(k(KEYS.TRIPS), JSON.stringify(updated));
}

/** Replace all trips (used by backup import). */
export async function saveAllTrips(trips: TripRecord[]): Promise<void> {
  const sorted = [...trips].sort(
    (a, b) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime()
  );
  await storage.setItem(k(KEYS.TRIPS), JSON.stringify(sorted));
}

export async function loadTrips(): Promise<TripRecord[]> {
  return readLocalTrips();
}

export async function loadTrip(id: string): Promise<TripRecord | null> {
  const local = await readLocalTrips();
  return local.find((t) => t.id === id) ?? null;
}

export async function deleteTrip(id: string): Promise<void> {
  const local = await readLocalTrips();
  await storage.setItem(k(KEYS.TRIPS), JSON.stringify(local.filter((t) => t.id !== id)));
}

export async function updateTripTitle(id: string, title: string): Promise<void> {
  const existing = await readLocalTrips();
  const updated = existing.map((t) => (t.id === id ? { ...t, title } : t));
  await storage.setItem(k(KEYS.TRIPS), JSON.stringify(updated));
}

export function calculateRange(
  batteryCapacity: number,
  batteryPercentage: number,
  consumptionPer100km: number
): { rangeKm: number; usableEnergy: number } {
  const usableEnergy = batteryCapacity * (batteryPercentage / 100);
  const rangeKm =
    consumptionPer100km > 0 ? (usableEnergy / consumptionPer100km) * 100 : 0;
  return {
    rangeKm: Math.round(rangeKm),
    usableEnergy: parseFloat(usableEnergy.toFixed(1)),
  };
}

export function haversineDistance(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number
): number {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export function formatDuration(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}
