/**
 * Pure trip-tracking logic. No React Native imports so it can be unit-tested
 * and run identically in the foreground, in the background task, and headless.
 *
 * Key ideas
 * ─────────
 * 1. Use the GPS fix timestamp, never "when JS happened to receive it".
 *    Background deliveries arrive in batches; using Date.now() made every
 *    batch look like a GPS outage and triggered bogus dead-reckoning.
 *
 * 2. Distance is "committed" only from real fixes. While GPS is missing the
 *    UI shows a *provisional* estimate (last speed × time), but that number is
 *    never written into the trip. When the next good fix arrives, the gap is
 *    measured from the last good position to the new one (straight line now,
 *    refined to road distance asynchronously). This removes double counting
 *    (bridge estimate + real fixes) and the old "parked for 2 hours with app
 *    in background → +200 km" bug.
 *
 * 3. Poor fixes (accuracy > 50 m, typical for network positions in tunnels)
 *    are ignored and do NOT count as signal, so tunnel mode actually engages
 *    on Android instead of freezing at 0 km/h.
 *
 * 4. Fast segments are validated by implied speed, not by a fixed 100 m jump
 *    limit — the old limit silently dropped every segment longer than 100 m
 *    (any 3 s fix gap at highway speed), under-counting distance.
 */

export interface Fix {
  lat: number;
  lon: number;
  ts: number;
  speedKmh: number | null;
  accuracy: number | null;
  altitude: number | null;
  altitudeAccuracy: number | null;
}

export interface GapRecord {
  fromLat: number;
  fromLon: number;
  toLat: number;
  toLon: number;
  startedTs: number;
  endedTs: number;
  straightKm: number;
  committedKm: number;
  lastSpeedKmh: number;
  /** true once the road-distance refinement has been applied */
  refined: boolean;
}

export interface TripState {
  version: 2;
  id: string;
  phase: 'driving' | 'paused';
  startedAt: number;
  /** active (non-paused) ms accumulated before the current resume */
  activeMsBefore: number;
  /** wall-clock ms of the last resume, null while paused */
  resumedAt: number | null;
  updatedAt: number;

  carName: string;
  batteryCapacity: number;
  startBattery: number;
  consumption: number;
  reservePercent: number;

  /** battery model: battery = anchor − energy(distance since anchorDistance) */
  batteryAnchor: number;
  batteryAnchorDistance: number;
  /** consumption is measured from this point (reset after a charge) */
  measureBattery: number;
  measureDistance: number;
  measuredConsumption: number | null;
  /** battery % used in the stretch the learned value is based on (confidence) */
  measuredUsedPct?: number | null;
  /** latest outside temperature (°C) */
  outsideTempC?: number | null;
  /** speed-aware consumption model (absent on drives started by older versions) */
  speed?: SpeedModel;

  distanceKm: number;
  estimatedKm: number;
  movingMs: number;
  gpsGaps: number;
  lastGap: GapRecord | null;

  lastFix: Fix | null;
  /** ts of the last fix that passed the accuracy filter */
  lastSignalAt: number;
  /** ts of the last fix of any quality */
  lastAnyFixAt: number;
  lastSpeedKmh: number;
  rejectStreak: number;

  altRef: number | null;
  elevationGainM: number;
  elevationLossM: number;
  minElevationM: number | null;
  maxElevationM: number | null;
  minTemperatureC: number | null;
  maxTemperatureC: number | null;
  lastTempFetchAt: number;
  minSpeedKmh: number | null;
  maxSpeedKmh: number | null;
  speedSamples: { t: number; s: number }[];
  lastSampleTs: number;
  /** sparse breadcrumb [lat, lon] for terrain elevation at the end */
  track?: [number, number][];
  trackLastKm?: number;
  trackSpacingKm?: number;
  /** "Can I make it?" destination for this drive (optional) */
  destination?: TripDestination | null;
}

/**
 * Speed-aware consumption.
 * consumption(v) = offset + SPEED_CURVE(v). The curve carries the speed effect
 * (air drag grows fast above ~80 km/h), the offset carries everything personal
 * (car, weather, heating, load). The offset starts from the consumption the
 * user picked (at a typical speed for that preset) and is learned from battery
 * corrections, so the app keeps learning while reacting to speed in real time.
 */
export interface SpeedModel {
  offset: number;
  /** smoothed recent driving speed (km/h), the speed the display/range use */
  ema: number;
  /** Σ km × curve(v) / 100 since the battery anchor (kWh at offset 0) */
  curveKwhSinceAnchor: number;
  /** same, since the learning start point */
  curveKwhSinceMeasure: number;
}

/** kWh/100 km by speed (from Marko's own driving): flat in town, ~28 at 160+. */
export const SPEED_CURVE: [number, number][] = [
  [0, 11],
  [60, 11],
  [80, 13],
  [100, 16],
  [120, 20],
  [130, 22],
  [140, 24],
  [160, 28],
];

export function curveAt(kmh: number): number {
  const v = Math.max(0, isFinite(kmh) ? kmh : 0);
  const pts = SPEED_CURVE;
  if (v >= pts[pts.length - 1][0]) return pts[pts.length - 1][1];
  for (let i = 1; i < pts.length; i++) {
    const [x1, y1] = pts[i];
    if (v <= x1) {
      const [x0, y0] = pts[i - 1];
      return y0 + ((y1 - y0) * (v - x0)) / (x1 - x0);
    }
  }
  return pts[0][1];
}

/** Typical average speed each preset stands for. */
export const STYLE_REF_KMH = { city: 45, mixed: 75, highway: 115, custom: 80 } as const;
const EMA_TAU_S = 240; // ~4 min smoothing so traffic lights don't make the range jump
const MIN_CONS = 6;
const MAX_CONS = 50;

function clampCons(c: number) {
  return Math.max(MIN_CONS, Math.min(MAX_CONS, c));
}

/** Upgrade a drive saved by an older version without changing its battery. */
export function ensureSpeedModel(s: TripState): SpeedModel {
  if (s.speed) return s.speed;
  const ref = STYLE_REF_KMH.custom;
  const c = curveAt(ref);
  s.speed = {
    offset: s.consumption - c,
    ema: ref,
    curveKwhSinceAnchor: (Math.max(0, s.distanceKm - s.batteryAnchorDistance) * c) / 100,
    curveKwhSinceMeasure: (Math.max(0, s.distanceKm - s.measureDistance) * c) / 100,
  };
  return s.speed;
}

function liveConsumption(s: TripState, kmh?: number): number {
  const m = ensureSpeedModel(s);
  return clampCons(m.offset + curveAt(kmh ?? m.ema));
}

function trackEnergy(s: TripState, km: number, kmh: number) {
  if (!isFinite(km) || km === 0) return;
  const m = ensureSpeedModel(s);
  const e = (km * curveAt(kmh)) / 100;
  m.curveKwhSinceAnchor = Math.max(0, m.curveKwhSinceAnchor + e);
  m.curveKwhSinceMeasure = Math.max(0, m.curveKwhSinceMeasure + e);
}

function updateEma(s: TripState, kmh: number, dtS: number) {
  if (!(dtS > 0) || !isFinite(kmh)) return;
  const m = ensureSpeedModel(s);
  const a = 1 - Math.exp(-dtS / EMA_TAU_S);
  m.ema = m.ema + (Math.min(200, kmh) - m.ema) * a;
  s.consumption = Math.round(liveConsumption(s) * 10) / 10;
}

export interface TripDestination {
  name: string;
  address: string;
  lat: number;
  lon: number;
  /** road km from where the route was last calculated */
  routeKm: number;
  minutes: number;
  netM: number;
  climbM: number;
  descentM: number;
  /** trip distance (km) at the moment the route was calculated */
  atDistanceKm: number;
  computedAt: number;
}

/** Road km still to go, estimated from distance driven since the last route calculation. */
export function destinationRemainingKm(s: TripState): number | null {
  const d = s.destination;
  if (!d) return null;
  return Math.max(0, d.routeKm - Math.max(0, s.distanceKm - d.atDistanceKm));
}

export const CFG = {
  MAX_ACCURACY_M: 50,
  /** fixes further apart than this are treated as a GPS gap */
  GAP_S: 20,
  MAX_PLAUSIBLE_KMH: 250,
  /** cap for reconstructed distance: assume no faster than this on average */
  GAP_MAX_AVG_KMH: 180,
  STATIONARY_KMH: 2.5,
  MOVING_KMH: 3,
  ELEV_STEP_M: 8,
  ELEV_MAX_VACC_M: 15,
  SAMPLE_EVERY_MS: 5000,
  MAX_SAMPLES: 1200,
  /** provisional (display-only) estimate during an outage */
  PROVISIONAL_AFTER_MS: 8000,
  PROVISIONAL_MAX_MS: 15 * 60 * 1000,
  PROVISIONAL_MAX_KM: 20,
  PROVISIONAL_MIN_KMH: 15,
  ROAD_REFINE_MIN_KM: 0.3,
};

export function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export function newTripState(p: {
  id: string;
  now: number;
  carName: string;
  batteryCapacity: number;
  startBattery: number;
  consumption: number;
  reservePercent: number;
  style?: keyof typeof STYLE_REF_KMH;
}): TripState {
  const ref = STYLE_REF_KMH[p.style ?? 'custom'] ?? STYLE_REF_KMH.custom;
  return {
    version: 2,
    id: p.id,
    phase: 'driving',
    startedAt: p.now,
    activeMsBefore: 0,
    resumedAt: p.now,
    updatedAt: p.now,
    carName: p.carName,
    batteryCapacity: p.batteryCapacity,
    startBattery: p.startBattery,
    consumption: p.consumption,
    reservePercent: p.reservePercent,
    batteryAnchor: p.startBattery,
    batteryAnchorDistance: 0,
    measureBattery: p.startBattery,
    measureDistance: 0,
    measuredConsumption: null,
    speed: { offset: p.consumption - curveAt(ref), ema: ref, curveKwhSinceAnchor: 0, curveKwhSinceMeasure: 0 },
    distanceKm: 0,
    estimatedKm: 0,
    movingMs: 0,
    gpsGaps: 0,
    lastGap: null,
    lastFix: null,
    lastSignalAt: 0,
    lastAnyFixAt: 0,
    lastSpeedKmh: 0,
    rejectStreak: 0,
    altRef: null,
    elevationGainM: 0,
    elevationLossM: 0,
    minElevationM: null,
    maxElevationM: null,
    minTemperatureC: null,
    maxTemperatureC: null,
    lastTempFetchAt: 0,
    minSpeedKmh: null,
    maxSpeedKmh: null,
    speedSamples: [],
    lastSampleTs: 0,
  };
}

export function activeMs(s: TripState, now: number): number {
  return s.activeMsBefore + (s.resumedAt != null ? Math.max(0, now - s.resumedAt) : 0);
}

function addDistance(s: TripState, km: number) {
  if (!(km > 0) || !isFinite(km)) return;
  s.distanceKm = round3(s.distanceKm + km);
}

const TRACK_MAX_POINTS = 1200;

function addTrackPoint(s: TripState, f: Fix, force = false) {
  const spacing = s.trackSpacingKm ?? 0.15;
  if (!s.track) s.track = [];
  if (!force && s.track.length && s.distanceKm - (s.trackLastKm ?? 0) < spacing) return;
  s.track.push([Math.round(f.lat * 1e5) / 1e5, Math.round(f.lon * 1e5) / 1e5]);
  s.trackLastKm = s.distanceKm;
  if (s.track.length > TRACK_MAX_POINTS) {
    // Long drive: keep every other point and double the spacing.
    s.track = s.track.filter((_, i) => i % 2 === 0 || i === s.track!.length - 1);
    s.trackSpacingKm = spacing * 2;
  }
}

function round3(n: number) {
  return Math.round(n * 1000) / 1000;
}

function trackElevation(s: TripState, f: Fix) {
  const alt = f.altitude;
  if (typeof alt !== 'number' || !isFinite(alt)) return;
  if (f.altitudeAccuracy != null && f.altitudeAccuracy > CFG.ELEV_MAX_VACC_M) return;
  if (s.minElevationM == null || alt < s.minElevationM) s.minElevationM = alt;
  if (s.maxElevationM == null || alt > s.maxElevationM) s.maxElevationM = alt;
  if (s.altRef == null) {
    s.altRef = alt;
    return;
  }
  const diff = alt - s.altRef;
  if (Math.abs(diff) >= CFG.ELEV_STEP_M) {
    if (diff > 0) s.elevationGainM += diff;
    else s.elevationLossM += -diff;
    s.altRef = alt;
  }
}

function sampleSpeed(s: TripState, f: Fix, kmh: number) {
  if (f.ts - s.lastSampleTs < CFG.SAMPLE_EVERY_MS) return;
  s.lastSampleTs = f.ts;
  const t = Math.max(0, Math.round(activeMs(s, f.ts) / 1000));
  s.speedSamples.push({ t, s: Math.round(kmh * 10) / 10 });
  if (s.speedSamples.length > CFG.MAX_SAMPLES) {
    s.speedSamples = s.speedSamples.filter((_, i) => i % 2 === 0);
  }
}

export type FixResult =
  | { kind: 'ignored'; reason: string }
  | { kind: 'anchor' }
  | { kind: 'stationary' }
  | { kind: 'moved'; km: number }
  | { kind: 'gap'; gap: GapRecord };

/**
 * Apply one GPS fix to the trip state (mutates `s`).
 * Returns what happened so the caller can e.g. request road distance for a gap.
 */
export function applyFix(s: TripState, f: Fix): FixResult {
  if (s.phase !== 'driving') return { kind: 'ignored', reason: 'paused' };
  if (!isFinite(f.lat) || !isFinite(f.lon) || !isFinite(f.ts)) {
    return { kind: 'ignored', reason: 'invalid' };
  }
  // Fixes from before the drive started/resumed (cached positions) are useless.
  if (s.resumedAt != null && f.ts < s.resumedAt - 5000 && !s.lastFix) {
    return { kind: 'ignored', reason: 'stale' };
  }
  if (s.lastFix && f.ts <= s.lastFix.ts) return { kind: 'ignored', reason: 'duplicate' };
  s.lastAnyFixAt = Math.max(s.lastAnyFixAt, f.ts);

  if (f.accuracy != null && f.accuracy > CFG.MAX_ACCURACY_M) {
    return { kind: 'ignored', reason: 'inaccurate' };
  }

  const reported = f.speedKmh != null && f.speedKmh >= 0 ? f.speedKmh : null;
  trackElevation(s, f);

  if (!s.lastFix) {
    s.lastFix = f;
    s.lastSignalAt = f.ts;
    s.lastSpeedKmh = reported ?? 0;
    if (!s.track?.length) addTrackPoint(s, f, true);
    return { kind: 'anchor' };
  }

  const prev = s.lastFix;
  const dt = (f.ts - prev.ts) / 1000;
  const d = haversineKm(prev.lat, prev.lon, f.lat, f.lon);
  const implied = dt > 0 ? (d / dt) * 3600 : 0;

  // ── GPS gap (tunnel, OS suspended the app, app killed…) ──
  if (dt > CFG.GAP_S) {
    const maxKm = (dt / 3600) * CFG.GAP_MAX_AVG_KMH;
    const committed = Math.min(d, maxKm);
    addDistance(s, committed);
    const gapKmh = dt > 0 ? (committed / dt) * 3600 : 0;
    trackEnergy(s, committed, gapKmh);
    if (gapKmh >= CFG.MOVING_KMH) updateEma(s, gapKmh, dt);
    s.estimatedKm = round3(s.estimatedKm + committed);
    s.gpsGaps += 1;
    const gap: GapRecord = {
      fromLat: prev.lat,
      fromLon: prev.lon,
      toLat: f.lat,
      toLon: f.lon,
      startedTs: prev.ts,
      endedTs: f.ts,
      straightKm: round3(d),
      committedKm: round3(committed),
      lastSpeedKmh: s.lastSpeedKmh,
      refined: false,
    };
    s.lastGap = gap;
    addTrackPoint(s, f, true);
    s.lastFix = f;
    s.lastSignalAt = f.ts;
    s.lastSpeedKmh = reported ?? 0;
    s.rejectStreak = 0;
    return { kind: 'gap', gap };
  }

  // ── Glitch filter: physically impossible jump ──
  if (implied > CFG.MAX_PLAUSIBLE_KMH && d > 0.05) {
    s.rejectStreak += 1;
    if (s.rejectStreak >= 3) {
      // The *anchor* was probably the bad one. Re-anchor without distance.
      s.lastFix = f;
      s.lastSignalAt = f.ts;
      s.rejectStreak = 0;
      return { kind: 'anchor' };
    }
    return { kind: 'ignored', reason: 'glitch' };
  }
  s.rejectStreak = 0;
  s.lastSignalAt = f.ts;

  const kmh = reported ?? implied;
  s.lastSpeedKmh = kmh;
  sampleSpeed(s, f, kmh);

  // ── Stationary jitter: keep the anchor where it is, just advance time ──
  // The anchor only moves once we've clearly left the noise radius, so slow
  // crawling still accumulates while standing-still jitter does not.
  const acc = f.accuracy ?? 10;
  const jitterM =
    reported != null && reported < CFG.STATIONARY_KMH
      ? Math.min(60, Math.max(15, 3 * acc)) // GPS Doppler says "stopped": trust it
      : Math.min(30, Math.max(8, 1.5 * acc));
  if ((reported == null || reported < CFG.STATIONARY_KMH * 4) && d * 1000 < jitterM) {
    s.lastFix = { ...prev, ts: f.ts };
    return { kind: 'stationary' };
  }

  // Moving, but this fix is still inside the noise radius of the anchor:
  // wait for a longer chord (cuts zig-zag over-counting at city speeds).
  const minStepM = Math.max(6, Math.min(20, acc));
  if (d * 1000 < minStepM && dt < 10) {
    return { kind: 'stationary' };
  }

  addDistance(s, d);
  trackEnergy(s, d, kmh);
  if (kmh >= CFG.MOVING_KMH) {
    s.movingMs += dt * 1000;
    updateEma(s, kmh, dt);
  }
  if (reported != null && reported >= CFG.MOVING_KMH && reported <= CFG.MAX_PLAUSIBLE_KMH) {
    if (s.maxSpeedKmh == null || reported > s.maxSpeedKmh) s.maxSpeedKmh = reported;
    if (s.minSpeedKmh == null || reported < s.minSpeedKmh) s.minSpeedKmh = reported;
  }
  addTrackPoint(s, f);
  s.lastFix = f;
  return { kind: 'moved', km: d };
}

/**
 * Apply the road-distance refinement for a gap. Returns the km delta applied.
 * Sanity: road distance must be ≥ straight line and not absurdly longer
 * (a routing API sometimes picks a detour), and must respect the time cap.
 */
export function refineGap(s: TripState, gap: GapRecord, roadKm: number): number {
  if (!s.lastGap || s.lastGap.endedTs !== gap.endedTs || s.lastGap.refined) return 0;
  if (!isFinite(roadKm) || roadKm <= 0) return 0;
  const dtH = (gap.endedTs - gap.startedTs) / 3_600_000;
  const maxKm = dtH * CFG.GAP_MAX_AVG_KMH;
  const upper = Math.min(maxKm, Math.max(gap.straightKm * 2.2, gap.straightKm + 1));
  const target = Math.max(gap.straightKm, Math.min(roadKm, upper));
  const delta = round3(target - gap.committedKm);
  s.lastGap = { ...s.lastGap, refined: true, committedKm: round3(target) };
  if (delta !== 0) {
    const dtS = (gap.endedTs - gap.startedTs) / 1000;
    trackEnergy(s, delta, dtS > 0 ? (target / dtS) * 3600 : 0);
    s.distanceKm = round3(Math.max(0, s.distanceKm + delta));
    s.estimatedKm = round3(Math.max(0, s.estimatedKm + delta));
  }
  return delta;
}

/**
 * Fallback when no routing API answered: roads between two points far apart
 * are on average ~20% longer than the straight line. Short gaps (tunnels)
 * stay straight — tunnels are close to straight anyway.
 */
export function fallbackRoadKm(gap: GapRecord): number | null {
  const mins = (gap.endedTs - gap.startedTs) / 60000;
  if (gap.straightKm < 2 || mins < 3) return null;
  return gap.straightKm * 1.2;
}

export type GpsStatus = 'off' | 'searching' | 'active' | 'weak' | 'lost';

export interface Snapshot {
  phase: TripState['phase'];
  distanceKm: number;
  committedKm: number;
  provisionalKm: number;
  elapsedSec: number;
  movingSec: number;
  speedKmh: number;
  battery: number;
  usableBattery: number;
  rangeKm: number;
  energyUsedKwh: number;
  consumption: number;
  /** smoothed speed the consumption/range are calculated for */
  speedBasisKmh: number;
  measuredConsumption: number | null;
  learnConfidence: 'none' | 'low' | 'medium' | 'high';
  outsideTempC: number | null;
  reservePercent: number;
  gps: GpsStatus;
  signalAgeSec: number;
  avgSpeedKmh: number;
  estimatedKm: number;
  gpsGaps: number;
}

export function batteryAt(s: TripState, distanceKm: number): number {
  const m = ensureSpeedModel(s);
  const since = Math.max(0, s.distanceKm - s.batteryAnchorDistance);
  // provisional km (tunnel estimate) beyond the committed distance
  const extra = Math.max(0, distanceKm - s.distanceKm);
  let kwh = (since * m.offset) / 100 + m.curveKwhSinceAnchor;
  kwh += (extra * liveConsumption(s, s.lastSpeedKmh)) / 100;
  // never let a low/negative offset make energy go below a sane floor
  kwh = Math.max(kwh, (since * MIN_CONS) / 100);
  const drop = s.batteryCapacity > 0 ? (kwh / s.batteryCapacity) * 100 : 0;
  return Math.max(0, Math.min(100, s.batteryAnchor - drop));
}

export function rangeFor(capacityKwh: number, batteryPct: number, consumption: number, reserve = 0) {
  const usable = Math.max(0, batteryPct - reserve);
  return consumption > 0 ? (capacityKwh * (usable / 100) * 100) / consumption : 0;
}

export function snapshot(s: TripState, now: number): Snapshot {
  const signalAgeMs = s.lastSignalAt ? Math.max(0, now - s.lastSignalAt) : Infinity;
  let gps: GpsStatus = 'off';
  let provisionalKm = 0;
  if (s.phase === 'driving') {
    if (!s.lastSignalAt) gps = 'searching';
    else if (signalAgeMs < 6000) gps = 'active';
    else if (signalAgeMs < 12000) gps = 'weak';
    else gps = 'lost';

    if (
      s.lastFix &&
      signalAgeMs > CFG.PROVISIONAL_AFTER_MS &&
      signalAgeMs < CFG.PROVISIONAL_MAX_MS &&
      s.lastSpeedKmh >= CFG.PROVISIONAL_MIN_KMH
    ) {
      provisionalKm = Math.min(
        CFG.PROVISIONAL_MAX_KM,
        (s.lastSpeedKmh * (signalAgeMs - CFG.PROVISIONAL_AFTER_MS / 2)) / 3_600_000
      );
    }
  }
  const distanceKm = s.distanceKm + provisionalKm;
  const battery = batteryAt(s, distanceKm);
  const consumption = Math.round(liveConsumption(s) * 10) / 10;
  const usableBattery = Math.max(0, battery - s.reservePercent);
  const elapsedSec = Math.floor(activeMs(s, now) / 1000);
  const movingSec = Math.floor(s.movingMs / 1000);
  return {
    phase: s.phase,
    distanceKm,
    committedKm: s.distanceKm,
    provisionalKm,
    elapsedSec,
    movingSec,
    speedKmh: gps === 'active' || gps === 'weak' ? Math.max(0, s.lastSpeedKmh) : 0,
    battery,
    usableBattery,
    rangeKm: rangeFor(s.batteryCapacity, battery, consumption, s.reservePercent),
    energyUsedKwh: Math.max(0, (s.batteryCapacity * (s.startBattery - battery)) / 100),
    consumption,
    speedBasisKmh: Math.round(ensureSpeedModel(s).ema),
    measuredConsumption: s.measuredConsumption,
    learnConfidence:
      s.measuredConsumption == null || s.measuredUsedPct == null
        ? 'none'
        : s.measuredUsedPct < 4
          ? 'low'
          : s.measuredUsedPct < 8
            ? 'medium'
            : 'high',
    outsideTempC: s.outsideTempC ?? null,
    reservePercent: s.reservePercent,
    gps,
    signalAgeSec: isFinite(signalAgeMs) ? Math.floor(signalAgeMs / 1000) : -1,
    avgSpeedKmh: movingSec > 60 ? s.distanceKm / (movingSec / 3600) : 0,
    estimatedKm: s.estimatedKm,
    gpsGaps: s.gpsGaps,
  };
}

/**
 * User corrected the battery % (read from the car). Rebase the model and,
 * after enough distance, learn the real consumption so the range self-corrects.
 */
export const CHARGE_JUMP_PCT = 10;

export function correctBattery(s: TripState, value: number, now: number): { learned: number | null } {
  const m = ensureSpeedModel(s);
  const v = Math.max(0, Math.min(100, Math.round(value * 10) / 10));
  const predicted = batteryAt(s, s.distanceKm);
  // Big jump up → the car was charged. Restart consumption measurement.
  // Smaller upward corrections are just the estimate being too pessimistic —
  // those are exactly what the learning below needs.
  if (v >= predicted + CHARGE_JUMP_PCT) {
    s.measureBattery = v;
    s.measureDistance = s.distanceKm;
    m.curveKwhSinceMeasure = 0;
  }
  s.batteryAnchor = v;
  s.batteryAnchorDistance = s.distanceKm;
  m.curveKwhSinceAnchor = 0;
  s.updatedAt = now;

  let learned: number | null = null;
  const dist = s.distanceKm - s.measureDistance;
  const usedPct = s.measureBattery - v;
  // The car shows whole %, so short stretches are dominated by rounding
  // (1 % ≈ 0.5 kWh). Learn only from enough evidence, and blend with the
  // current value instead of replacing it — more battery used = more weight.
  if (dist >= 5 && usedPct >= 2 && (usedPct >= 3 || dist >= 15)) {
    const c = (s.batteryCapacity * (usedPct / 100) * 100) / dist;
    if (c >= 5 && c <= 50) {
      // What the speed curve alone explains for this stretch; the rest is personal.
      const curveAvg = (m.curveKwhSinceMeasure / dist) * 100;
      const measuredOffset = c - curveAvg;
      const w = Math.max(0.2, Math.min(0.9, 1 - 1.5 / usedPct));
      m.offset = m.offset * (1 - w) + measuredOffset * w;
      learned = Math.round(liveConsumption(s) * 10) / 10;
      s.measuredConsumption = learned;
      s.measuredUsedPct = usedPct;
      s.consumption = learned;
    }
  }
  return { learned };
}

export function setConsumption(s: TripState, c: number, now: number) {
  // Rebase first so a new consumption only affects the km still to come.
  const m = ensureSpeedModel(s);
  const current = batteryAt(s, s.distanceKm);
  s.batteryAnchor = current;
  s.batteryAnchorDistance = s.distanceKm;
  m.curveKwhSinceAnchor = 0;
  const v = clampCons(Math.round(c * 10) / 10);
  // The value the user sets applies at the speed they're driving now.
  m.offset = v - curveAt(m.ema);
  s.consumption = v;
  s.updatedAt = now;
}

export function pause(s: TripState, now: number) {
  if (s.phase === 'paused') return;
  s.activeMsBefore = activeMs(s, now);
  s.resumedAt = null;
  s.phase = 'paused';
  s.updatedAt = now;
}

export function resume(s: TripState, now: number) {
  if (s.phase === 'driving') return;
  s.phase = 'driving';
  s.resumedAt = now;
  // Don't bridge the paused period: the car may have been moved by someone
  // else, ferry, charging stop… Start a fresh anchor.
  s.lastFix = null;
  s.lastSignalAt = 0;
  s.lastSpeedKmh = 0;
  s.updatedAt = now;
}

/** Real consumption for the whole trip, from the battery you read at the end. */
export function finalConsumption(s: TripState, endBattery: number): number | null {
  const dist = s.distanceKm - s.measureDistance;
  const used = s.measureBattery - endBattery;
  if (dist < 0.5 || used <= 0) return null;
  const c = (s.batteryCapacity * (used / 100) * 100) / dist;
  return c > 0 && c < 80 ? Math.round(c * 10) / 10 : null;
}
