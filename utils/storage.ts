import { Platform } from 'react-native';
import { supabase } from './supabase';
import { kv } from './kv';

// All persistence goes through kv (AsyncStorage on native, localStorage on web).
const storage = kv;

// Active user id used to namespace local-storage keys. `null` means "guest"
// (pre-login), keeping backwards compatibility with existing devices.
let activeUserId: string | null = null;

export function setActiveUser(userId: string | null): void {
  activeUserId = userId;
}

// Resolve the signed-in user before touching namespaced keys. Screens opened
// directly (deep link / reload) can run before AuthGate has called
// setActiveUser, which made trips and prefs look empty.
async function ensureUser(): Promise<void> {
  if (activeUserId) return;
  try {
    const {
      data: { session },
    } = await supabase.auth.getSession();
    if (session?.user?.id) activeUserId = session.user.id;
  } catch {
    // offline
  }
}

/** User-namespaced storage key (for modules that keep their own data). */
export function userKey(key: string): string {
  return k(key);
}

function k(key: string): string {
  return activeUserId ? `u:${activeUserId}:${key}` : key;
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

export async function ensureUserLoaded(): Promise<void> {
  await ensureUser();
}

export async function loadPrefs(): Promise<UserPrefs> {
  await ensureUser();
  const raw = await storage.getItem(k(KEYS.PREFS));
  if (!raw) return { ...DEFAULT_PREFS };
  try {
    return { ...DEFAULT_PREFS, ...JSON.parse(raw) };
  } catch {
    return { ...DEFAULT_PREFS };
  }
}

export async function savePrefs(p: UserPrefs): Promise<void> {
  await ensureUser();
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

export function getActiveUserId(): string | null {
  return activeUserId;
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

export async function syncActiveSessionToCloud(s: ActiveDriveSession): Promise<void> {
  if (!activeUserId) return; // guest mode — local only
  try {
    await supabase.from('active_drive_sessions').upsert({
      id: s.id,
      user_id: activeUserId,
      started_at: s.startedAt,
      updated_at: new Date().toISOString(),
      phase: s.phase,
      car_name: s.carName,
      battery_capacity: s.batteryCapacity,
      start_battery: s.startBattery,
      current_battery: s.currentBattery,
      distance_km: s.distanceKm,
      elapsed_seconds: s.elapsedSeconds,
      consumption: s.consumption,
      reserve_enabled: s.reserveEnabled,
      target_battery: s.targetBattery,
      min_elevation_m: s.minElevationM,
      max_elevation_m: s.maxElevationM,
      min_temperature_c: s.minTemperatureC,
      max_temperature_c: s.maxTemperatureC,
      min_speed_kmh: s.minSpeedKmh,
      max_speed_kmh: s.maxSpeedKmh,
      last_coord_lat: s.lastCoordLat,
      last_coord_lon: s.lastCoordLon,
      last_speed_kmh: s.lastSpeedKmh,
    });
  } catch {
    // cloud backup best-effort; local is the source of truth
  }
}

export async function deleteActiveSessionFromCloud(id: string): Promise<void> {
  if (!activeUserId) return;
  try {
    await supabase.from('active_drive_sessions').delete().eq('id', id);
  } catch {
    // ignore
  }
}

export async function saveCarSettings(settings: CarSettings): Promise<void> {
  const json = JSON.stringify(settings);
  await storage.setItem(k(KEYS.CAR_SETTINGS), json);
  // Always mirror to the bare key so settings survive timing issues on reload
  if (activeUserId) {
    await storage.setItem(KEYS.CAR_SETTINGS, json);
    try {
      await supabase.from('user_car_settings').upsert({
        user_id: activeUserId,
        car_name: settings.carName,
        battery_capacity: settings.batteryCapacity,
        updated_at: new Date().toISOString(),
      });
    } catch {
      // local is source of truth
    }
  }
}

export async function loadCarSettings(): Promise<CarSettings | null> {
  // Ensure activeUserId is set if a session exists but the effect hasn't fired yet
  if (!activeUserId) {
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (session?.user?.id) {
        activeUserId = session.user.id;
      }
    } catch {
      // offline
    }
  }

  const data = await storage.getItem(k(KEYS.CAR_SETTINGS));
  if (data) return JSON.parse(data);

  // Check the bare (guest) key — settings may have been saved before user ID was set
  if (activeUserId) {
    const guestData = await storage.getItem(KEYS.CAR_SETTINGS);
    if (guestData) {
      await storage.setItem(k(KEYS.CAR_SETTINGS), guestData);
      return JSON.parse(guestData);
    }
    try {
      const { data: row } = await supabase
        .from('user_car_settings')
        .select('car_name, battery_capacity')
        .eq('user_id', activeUserId)
        .maybeSingle();
      if (row) {
        const settings: CarSettings = {
          carName: row.car_name,
          batteryCapacity: Number(row.battery_capacity),
        };
        const json = JSON.stringify(settings);
        await storage.setItem(k(KEYS.CAR_SETTINGS), json);
        await storage.setItem(KEYS.CAR_SETTINGS, json);
        return settings;
      }
    } catch {
      // offline — no settings yet
    }
  }
  return null;
}

export async function saveAppState(state: AppState): Promise<void> {
  const json = JSON.stringify(state);
  await storage.setItem(k(KEYS.APP_STATE), json);
  if (activeUserId) {
    await storage.setItem(KEYS.APP_STATE, json);
    try {
      await supabase
        .from('user_car_settings')
        .update({
          consumption: state.consumption,
          battery_percentage: state.batteryPercentage,
          preset: state.preset,
          updated_at: new Date().toISOString(),
        })
        .eq('user_id', activeUserId);
    } catch {
      // ignore
    }
  }
}

export async function loadAppState(): Promise<AppState | null> {
  // Ensure activeUserId is set if a session exists but the effect hasn't fired yet
  if (!activeUserId) {
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (session?.user?.id) {
        activeUserId = session.user.id;
      }
    } catch {
      // offline
    }
  }

  const data = await storage.getItem(k(KEYS.APP_STATE));
  if (data) return JSON.parse(data);
  if (activeUserId) {
    const guestData = await storage.getItem(KEYS.APP_STATE);
    if (guestData) {
      await storage.setItem(k(KEYS.APP_STATE), guestData);
      return JSON.parse(guestData);
    }
    try {
      const { data: row } = await supabase
        .from('user_car_settings')
        .select('consumption, battery_percentage, preset')
        .eq('user_id', activeUserId)
        .maybeSingle();
      if (row) {
        const state: AppState = {
          consumption: Number(row.consumption),
          batteryPercentage: Number(row.battery_percentage),
          preset: (row.preset as AppState['preset']) ?? 'custom',
        };
        const json = JSON.stringify(state);
        await storage.setItem(k(KEYS.APP_STATE), json);
        await storage.setItem(KEYS.APP_STATE, json);
        return state;
      }
    } catch {
      // ignore
    }
  }
  return null;
}

function tripToRow(t: TripRecord, withStats: boolean) {
  const row: Record<string, unknown> = {
    id: t.id,
    user_id: activeUserId,
    started_at: t.startedAt,
    ended_at: t.endedAt,
    distance_km: t.distanceKm,
    duration_seconds: t.durationSeconds,
    start_battery: t.startBattery,
    end_battery: t.endBattery,
    consumption: t.consumption,
    real_consumption: t.realConsumption,
    car_name: t.carName,
    battery_capacity: t.batteryCapacity,
    min_elevation_m: t.minElevationM ?? null,
    max_elevation_m: t.maxElevationM ?? null,
    min_temperature_c: t.minTemperatureC ?? null,
    max_temperature_c: t.maxTemperatureC ?? null,
    min_speed_kmh: t.minSpeedKmh ?? null,
    max_speed_kmh: t.maxSpeedKmh ?? null,
    speed_samples: t.speedSamples ?? null,
    title: t.title ?? null,
  };
  if (withStats) {
    row.stats = {
      movingSeconds: t.movingSeconds ?? null,
      elevationGainM: t.elevationGainM ?? null,
      elevationLossM: t.elevationLossM ?? null,
      estimatedKm: t.estimatedKm ?? null,
      gpsGaps: t.gpsGaps ?? null,
      reservePercent: t.reservePercent ?? null,
      rangeAtEndKm: t.rangeAtEndKm ?? null,
      pricePerKwh: t.pricePerKwh ?? null,
      priceSource: t.priceSource ?? null,
      currency: t.currency ?? null,
    };
  }
  return row;
}

function rowToTrip(r: any): TripRecord {
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

// Upsert trips to the cloud. If the `stats` column hasn't been migrated yet,
// retry without it so the core trip still syncs.
async function upsertTripRows(trips: TripRecord[]): Promise<void> {
  if (!activeUserId || trips.length === 0) return;
  try {
    const { error } = await supabase
      .from('user_trips')
      .upsert(trips.map((t) => tripToRow(t, true)), { onConflict: 'id' });
    if (error) {
      await supabase
        .from('user_trips')
        .upsert(trips.map((t) => tripToRow(t, false)), { onConflict: 'id' });
    }
  } catch {
    // keep local even if cloud fails
  }
}

async function readLocalTrips(): Promise<TripRecord[]> {
  await ensureUser();
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
  await ensureUser();
  const existing = await readLocalTrips();
  const updated = [trip, ...existing.filter((t) => t.id !== trip.id)];
  await storage.setItem(k(KEYS.TRIPS), JSON.stringify(updated));
  await upsertTripRows([trip]);
}

export async function loadTrips(): Promise<TripRecord[]> {
  const local = await readLocalTrips();
  if (!activeUserId) return local;
  try {
    const { data: rows, error } = await supabase
      .from('user_trips')
      .select('*')
      .eq('user_id', activeUserId)
      .order('started_at', { ascending: false });
    if (rows && !error) {
      const cloud: TripRecord[] = rows.map(rowToTrip);
      // Merge: cloud wins on conflicting ids, but keep local-only extra
      // stats if the cloud row doesn't have them yet.
      const byId: Record<string, TripRecord> = {};
      for (const t of local) byId[t.id] = t;
      for (const t of cloud) {
        const prev = byId[t.id];
        byId[t.id] = prev
          ? {
              ...prev,
              ...Object.fromEntries(
                Object.entries(t).filter(([, v]) => v !== null && v !== undefined)
              ),
            } as TripRecord
          : t;
      }
      const merged = Object.values(byId).sort(
        (a, b) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime()
      );
      await storage.setItem(k(KEYS.TRIPS), JSON.stringify(merged));
      return merged;
    }
  } catch {
    // offline — fall back to local
  }
  return local;
}

export async function loadTrip(id: string): Promise<TripRecord | null> {
  const local = await readLocalTrips();
  const hit = local.find((t) => t.id === id);
  if (hit) return hit;
  const all = await loadTrips();
  return all.find((t) => t.id === id) ?? null;
}

export async function deleteTrip(id: string): Promise<void> {
  // Delete from cloud FIRST so a subsequent loadTrips() merge won't
  // re-introduce the trip from the server.
  if (activeUserId) {
    try {
      await supabase.from('user_trips').delete().eq('id', id).eq('user_id', activeUserId);
    } catch {
      // ignore — local delete still proceeds
    }
  }
  const local = await readLocalTrips();
  await storage.setItem(k(KEYS.TRIPS), JSON.stringify(local.filter((t) => t.id !== id)));
}

export async function updateTripTitle(id: string, title: string): Promise<void> {
  const existing = await readLocalTrips();
  const updated = existing.map((t) => (t.id === id ? { ...t, title } : t));
  await storage.setItem(k(KEYS.TRIPS), JSON.stringify(updated));
  if (activeUserId) {
    try {
      await supabase.from('user_trips').update({ title: title || null }).eq('id', id);
    } catch {
      // ignore
    }
  }
}

// Push any locally-saved trips that aren't in the cloud yet (e.g. recorded
// before the user logged in, or while offline). Best-effort.
export async function pushLocalTripsToCloud(): Promise<void> {
  await ensureUser();
  if (!activeUserId) return;
  const trips = await readLocalTrips();
  await upsertTripRows(trips);
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
