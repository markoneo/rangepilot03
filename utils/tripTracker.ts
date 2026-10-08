/**
 * Trip tracker — single source of truth for the active drive.
 *
 * Lives outside React so it keeps working when the drive screen is unmounted,
 * when the app is in the background, and when Android runs the background
 * location task headless after the app was swiped away. State is persisted to
 * AsyncStorage/localStorage so a killed app resumes exactly where it was.
 */
import { AppState as RNAppState, Platform } from 'react-native';
import {
  applyFix,
  correctBattery,
  fallbackRoadKm,
  finalConsumption,
  newTripState,
  pause as corePause,
  refineGap,
  resume as coreResume,
  setConsumption as coreSetConsumption,
  snapshot,
  rangeFor,
  type Fix,
  type GapRecord,
  type Snapshot,
  type TripState,
} from './trackCore';
import {
  defineBackgroundLocationTask,
  startLocationUpdates,
  stopBackgroundUpdates,
  type GeoCoords,
  type GeoWatcher,
} from './geolocation';
import { readJSON, writeJSON, kv } from './kv';
import {
  activeTripKey,
  clearActiveSession,
  deleteActiveSessionFromCloud,
  loadPrefs,
  saveTrip,
  syncActiveSessionToCloud,
  type TripRecord,
} from './storage';
import { logTunnelGap, resolveTunnelDistance } from './tunnelBridge';
import { getOutsideTempC } from './weather';
import { currentAveragePrice } from './charges';

export type { Snapshot } from './trackCore';

type Listener = (s: TripState | null) => void;

let state: TripState | null = null;
let loaded = false;
let loadPromise: Promise<TripState | null> | null = null;
let watcher: GeoWatcher | null = null;
let lastSaveAt = 0;
let lastCloudAt = 0;
let chain: Promise<unknown> = Promise.resolve();
const listeners = new Set<Listener>();

const SAVE_EVERY_MS = 3000;
const CLOUD_EVERY_MS = 30000;
const TEMP_EVERY_MS = 10 * 60 * 1000;

function notify() {
  listeners.forEach((l) => {
    try {
      l(state);
    } catch {
      // ignore
    }
  });
}

/** Serialize all mutations (foreground + background fixes, UI actions). */
function run<T>(fn: () => Promise<T> | T): Promise<T> {
  const next = chain.then(fn, fn);
  chain = next.catch(() => {});
  return next;
}

async function persist(force = false) {
  if (!state) return;
  const now = Date.now();
  if (!force && now - lastSaveAt < SAVE_EVERY_MS) return;
  lastSaveAt = now;
  state.updatedAt = now;
  await writeJSON(activeTripKey(), state);
  if (force || now - lastCloudAt > CLOUD_EVERY_MS) {
    lastCloudAt = now;
    syncActiveSessionToCloud(toCloud(state)).catch(() => {});
  }
}

function toCloud(s: TripState) {
  const snap = snapshot(s, Date.now());
  return {
    id: s.id,
    startedAt: new Date(s.startedAt).toISOString(),
    updatedAt: new Date(s.updatedAt).toISOString(),
    phase: s.phase,
    carName: s.carName,
    batteryCapacity: s.batteryCapacity,
    startBattery: s.startBattery,
    currentBattery: Math.round(snap.battery * 10) / 10,
    batteryAnchor: s.batteryAnchor,
    batteryAnchorDistance: s.batteryAnchorDistance,
    distanceKm: s.distanceKm,
    elapsedSeconds: snap.elapsedSec,
    consumption: s.consumption,
    reserveEnabled: s.reservePercent > 0,
    targetBattery: s.reservePercent,
    minElevationM: s.minElevationM,
    maxElevationM: s.maxElevationM,
    minTemperatureC: s.minTemperatureC,
    maxTemperatureC: s.maxTemperatureC,
    minSpeedKmh: s.minSpeedKmh,
    maxSpeedKmh: s.maxSpeedKmh,
    lastCoordLat: s.lastFix?.lat ?? null,
    lastCoordLon: s.lastFix?.lon ?? null,
    lastSpeedKmh: s.lastSpeedKmh,
  };
}

export function loadActiveTrip(): Promise<TripState | null> {
  if (loaded) return Promise.resolve(state);
  if (!loadPromise) {
    loadPromise = (async () => {
      const s = await readJSON<TripState>(activeTripKey());
      // Only adopt from disk if nothing started in memory meanwhile.
      if (!state && s && s.version === 2 && s.id) state = s;
      loaded = true;
      loadPromise = null;
      notify();
      return state;
    })();
  }
  return loadPromise;
}

/** Re-read from disk (e.g. after the user id namespace changed). */
export async function reloadActiveTrip(): Promise<TripState | null> {
  if (watcher) return state; // a live trip is running — keep it
  loaded = false;
  state = null;
  return loadActiveTrip();
}

export function getTrip(): TripState | null {
  return state;
}

export function getSnapshot(now = Date.now()): Snapshot | null {
  return state ? snapshot(state, now) : null;
}

export function subscribe(l: Listener): () => void {
  listeners.add(l);
  return () => listeners.delete(l);
}

function toFix(c: GeoCoords): Fix {
  return {
    lat: c.latitude,
    lon: c.longitude,
    ts: c.timestamp || Date.now(),
    speedKmh: c.speed != null && c.speed >= 0 ? c.speed * 3.6 : null,
    accuracy: c.accuracy,
    altitude: c.altitude,
    altitudeAccuracy: c.altitudeAccuracy,
  };
}

async function handleFixes(coords: GeoCoords[]) {
  return run(async () => {
    if (!loaded) await loadActiveTrip();
    if (!state || state.phase !== 'driving') return;
    const sorted = [...coords].sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0));
    let changed = false;
    for (const c of sorted) {
      const r = applyFix(state, toFix(c));
      if (r.kind === 'gap') {
        changed = true;
        onGap(state.id, r.gap);
      } else if (r.kind === 'moved' || r.kind === 'anchor' || r.kind === 'stationary') {
        changed = true;
      }
    }
    if (!changed) return;
    maybeFetchTemperature();
    await persist();
    notify();
  });
}

function onGap(tripId: string, gap: GapRecord) {
  const finish = (roadKm: number | null, source: string) => {
    run(async () => {
      if (!state || state.id !== tripId) return;
      const km = roadKm ?? fallbackRoadKm(gap);
      if (km != null) refineGap(state, gap, km);
      await persist(true);
      notify();
      logTunnelGap({
        trip_id: tripId,
        started_at: new Date(gap.startedTs).toISOString(),
        ended_at: new Date(gap.endedTs).toISOString(),
        last_coord_lat: gap.fromLat,
        last_coord_lon: gap.fromLon,
        first_recovered_lat: gap.toLat,
        first_recovered_lon: gap.toLon,
        last_speed_kmh: gap.lastSpeedKmh,
        bridged_km: 0,
        straight_line_km: gap.straightKm,
        road_api_km: roadKm,
        final_km_used: state.lastGap?.committedKm ?? gap.committedKm,
        source,
      });
    });
  };
  if (gap.straightKm < 0.3) {
    finish(null, 'haversine');
    return;
  }
  resolveTunnelDistance(
    { lat: gap.fromLat, lon: gap.fromLon },
    { lat: gap.toLat, lon: gap.toLon },
    gap.straightKm
  )
    .then((r) => finish(r.road_api_km, r.road_api_km != null ? 'road_api' : 'haversine'))
    .catch(() => finish(null, 'haversine'));
}

function maybeFetchTemperature() {
  if (!state?.lastFix) return;
  const now = Date.now();
  if (now - state.lastTempFetchAt < TEMP_EVERY_MS) return;
  state.lastTempFetchAt = now;
  const id = state.id;
  const { lat, lon } = state.lastFix;
  getOutsideTempC(lat, lon).then((t) => {
    if (t == null) return;
    run(() => {
      if (!state || state.id !== id) return;
      if (state.minTemperatureC == null || t < state.minTemperatureC) state.minTemperatureC = t;
      if (state.maxTemperatureC == null || t > state.maxTemperatureC) state.maxTemperatureC = t;
      state.outsideTempC = t;
      notify();
    });
  });
}

function startWatching() {
  if (watcher) return;
  watcher = startLocationUpdates((c) => {
    handleFixes([c]);
  });
}

function stopWatching() {
  watcher?.remove();
  watcher = null;
  stopBackgroundUpdates();
}

// ── Public actions ─────────────────────────────────────────────────────────

export async function startTrip(p: {
  carName: string;
  batteryCapacity: number;
  startBattery: number;
  consumption: number;
  reservePercent: number;
}): Promise<TripState> {
  return run(async () => {
    const now = Date.now();
    state = newTripState({ id: String(now), now, ...p });
    loaded = true;
    await clearActiveSession(); // legacy v1 key
    await persist(true);
    startWatching();
    notify();
    return state;
  });
}

/** Call on app start: if a drive was running, restart GPS immediately. */
export async function resumeTrackingIfNeeded(): Promise<TripState | null> {
  const s = await loadActiveTrip();
  if (s && s.phase === 'driving') startWatching();
  return s;
}

export function pauseTrip() {
  return run(async () => {
    if (!state) return;
    corePause(state, Date.now());
    stopWatching();
    await persist(true);
    notify();
  });
}

export function resumeTrip() {
  return run(async () => {
    if (!state) return;
    coreResume(state, Date.now());
    startWatching();
    await persist(true);
    notify();
  });
}

export function setBattery(value: number): Promise<{ learned: number | null }> {
  return run(async () => {
    if (!state) return { learned: null };
    const r = correctBattery(state, value, Date.now());
    await persist(true);
    notify();
    return r;
  });
}

export function setConsumption(value: number) {
  return run(async () => {
    if (!state) return;
    coreSetConsumption(state, value, Date.now());
    await persist(true);
    notify();
  });
}

export function setReserve(pct: number) {
  return run(async () => {
    if (!state) return;
    state.reservePercent = Math.max(0, Math.min(50, Math.round(pct)));
    await persist(true);
    notify();
  });
}

export function setDestination(d: TripState['destination']) {
  return run(async () => {
    if (!state) return;
    state.destination = d ?? null;
    await persist(true);
    notify();
  });
}

export async function finishTrip(endBatteryInput: number | null): Promise<TripRecord | null> {
  return run(async () => {
    if (!state) return null;
    const s = state;
    const now = Date.now();
    stopWatching();
    if (s.phase === 'driving') corePause(s, now);
    const snap = snapshot(s, now);
    const endBattery =
      endBatteryInput != null && isFinite(endBatteryInput) && endBatteryInput >= 0 && endBatteryInput <= 100
        ? endBatteryInput
        : snap.battery;
    const prefs = await loadPrefs();
    const chargePrice = await currentAveragePrice();
    const real = finalConsumption(s, endBattery);
    const r1 = (n: number | null) => (n != null ? Math.round(n * 10) / 10 : null);

    const trip: TripRecord = {
      id: s.id,
      startedAt: new Date(s.startedAt).toISOString(),
      endedAt: new Date(now).toISOString(),
      distanceKm: Math.round(s.distanceKm * 100) / 100,
      durationSeconds: snap.elapsedSec,
      startBattery: s.startBattery,
      endBattery: Math.round(endBattery * 10) / 10,
      consumption: s.consumption,
      realConsumption: real,
      carName: s.carName,
      batteryCapacity: s.batteryCapacity,
      minElevationM: r1(s.minElevationM),
      maxElevationM: r1(s.maxElevationM),
      minTemperatureC: r1(s.minTemperatureC),
      maxTemperatureC: r1(s.maxTemperatureC),
      minSpeedKmh: r1(s.minSpeedKmh),
      maxSpeedKmh: r1(s.maxSpeedKmh),
      speedSamples: s.speedSamples.length > 1 ? s.speedSamples : null,
      movingSeconds: Math.round(s.movingMs / 1000),
      elevationGainM: Math.round(s.elevationGainM),
      elevationLossM: Math.round(s.elevationLossM),
      estimatedKm: Math.round(s.estimatedKm * 100) / 100,
      gpsGaps: s.gpsGaps,
      reservePercent: s.reservePercent,
      rangeAtEndKm: Math.round(
        rangeFor(s.batteryCapacity, endBattery, real ?? s.consumption, 0)
      ),
      pricePerKwh: chargePrice ?? prefs.electricityPrice,
      priceSource: chargePrice != null ? 'charges' : prefs.electricityPrice != null ? 'settings' : null,
      currency: prefs.currency,
    };

    await saveTrip(trip);
    await kv.removeItem(activeTripKey());
    deleteActiveSessionFromCloud(s.id);
    state = null;
    notify();
    return trip;
  });
}

export async function discardTrip() {
  return run(async () => {
    if (!state) return;
    const id = state.id;
    stopWatching();
    await kv.removeItem(activeTripKey());
    deleteActiveSessionFromCloud(id);
    state = null;
    notify();
  });
}

// ── Module-scope wiring ────────────────────────────────────────────────────

// Background fixes (also headless on Android) go straight into the tracker.
defineBackgroundLocationTask((fixes) => handleFixes(fixes));

// Save immediately when the app is backgrounded, and re-sync on return.
RNAppState.addEventListener('change', (st) => {
  if (st === 'background' || st === 'inactive') {
    run(() => persist(true));
  } else if (st === 'active') {
    notify();
  }
});

if (Platform.OS === 'web' && typeof document !== 'undefined') {
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') run(() => persist(true));
    else notify();
  });
  if (typeof window !== 'undefined') {
    window.addEventListener('pagehide', () => {
      run(() => persist(true));
    });
  }
}
