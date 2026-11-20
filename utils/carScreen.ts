import { AppState as RNAppState, Platform } from 'react-native';
import * as Trip from './tripTracker';
import { loadAppState, loadCarSettings, loadPrefs, savePrefs } from './storage';
import { destinationRemainingKm, rangeFor } from './trackCore';
import { estimateArrival, loadRecentPlaces, rememberPlace } from './maps';
import { carScreenAvailable, setCarState, takeCarDestination, takeCarReserve, type CarState } from '../modules/range-pilot-car';

/**
 * Android Auto: the car screen (range dial, battery, consumption, chargers
 * nearby) is native and can run while this app is closed, so the latest battery,
 * range, consumption and position are handed over here.
 * During a drive that is the live drive; otherwise the values from the home
 * screen. Does nothing on iOS and the web.
 */

const DRIVE_EVERY_MS = 5000;
const IDLE_EVERY_MS = 30000;

let lastKey = '';
let lastSentAt = 0;
let busy = false;
let recents: CarState['recents'] = [];
let recentsAt = 0;

async function sync(force = false) {
  if (busy) return;
  const now = Date.now();
  let snap = Trip.getSnapshot();
  let trip = Trip.getTrip();
  const driving = !!(snap && trip);
  if (!force && now - lastSentAt < (driving ? DRIVE_EVERY_MS : IDLE_EVERY_MS)) return;
  busy = true;
  lastSentAt = now;
  try {
    // reserve changed on the car screen: the running drive, or the default for the next one
    const picked = takeCarReserve();
    if (picked != null) {
      if (driving) {
        await Trip.setReserve(picked);
      } else {
        const prefs = await loadPrefs();
        await savePrefs({ ...prefs, defaultReserve: picked });
      }
    }
    // destination picked or cleared on the car screen
    const picked2 = takeCarDestination();
    if (picked2) {
      if (picked2.clear) {
        if (driving) await Trip.setDestination(null);
      } else {
        const { name, address, lat, lon, routeKm, minutes, netM, climbM, descentM } = picked2;
        await rememberPlace({ name, address, lat, lon });
        recentsAt = 0;
        if (driving) {
          await Trip.setDestination({
            name,
            address,
            lat,
            lon,
            routeKm,
            minutes,
            netM,
            climbM,
            descentM,
            atDistanceKm: Trip.getTrip()?.distanceKm ?? 0,
            computedAt: now,
          });
        }
      }
    }
    if (now - recentsAt > 60000) {
      recents = (await loadRecentPlaces()).slice(0, 6);
      recentsAt = now;
    }
    snap = Trip.getSnapshot();
    trip = Trip.getTrip();
    const shared = {
      ts: now,
      ocmKey: process.env.EXPO_PUBLIC_OCM_KEY || '',
      googleKey: process.env.EXPO_PUBLIC_GOOGLE_MAPS_KEY || '',
      recents,
    };
    let state: CarState;
    if (snap && trip) {
      const fix = trip.lastFix;
      // same figures as the arrival card on the phone's drive screen
      const plan = snap.obdLive ? snap.flatConsumption : snap.consumption;
      let dest: CarState['dest'] = null;
      const d = trip.destination;
      if (d) {
        const remaining = destinationRemainingKm(trip) ?? d.routeKm;
        const frac = d.routeKm > 0 ? remaining / d.routeKm : 0;
        const est = estimateArrival({
          capacityKwh: trip.batteryCapacity,
          batteryPct: snap.battery,
          consumption: plan,
          reservePct: snap.reservePercent,
          km: remaining,
          netM: d.netM * frac,
        });
        dest = {
          name: d.name,
          address: d.address,
          lat: d.lat,
          lon: d.lon,
          remainingKm: remaining,
          minutes: d.minutes * frac,
          arrivalPct: est.arrivalPct,
          status: est.status,
        };
      }
      state = {
        battery: Math.max(0, Math.min(100, snap.battery)),
        usable: snap.usableBattery,
        rangeKm: Math.max(0, snap.rangeKm),
        consumption: snap.recentConsumption ?? snap.consumption,
        capacityKwh: trip.batteryCapacity,
        driving: true,
        reserve: snap.reservePercent,
        obd: snap.obdLive,
        lat: fix ? fix.lat : null,
        lon: fix ? fix.lon : null,
        fixTs: fix ? fix.ts : null,
        planConsumption: plan,
        dest,
        ...shared,
      };
    } else {
      const [car, app, prefs] = await Promise.all([loadCarSettings(), loadAppState(), loadPrefs()]);
      if (!car || !app) return;
      const reserve = prefs.defaultReserve || 0;
      state = {
        battery: app.batteryPercentage,
        usable: Math.max(0, app.batteryPercentage - reserve),
        rangeKm: rangeFor(car.batteryCapacity, app.batteryPercentage, app.consumption, reserve),
        consumption: app.consumption,
        capacityKwh: car.batteryCapacity,
        driving: false,
        reserve,
        obd: false,
        lat: null,
        lon: null,
        fixTs: null,
        planConsumption: app.consumption,
        dest: null,
        ...shared,
      };
    }
    // the position moves all the time: only write when something the car shows has changed
    const key = [
      Math.round(state.battery),
      Math.round(state.usable),
      Math.round(state.rangeKm),
      state.consumption.toFixed(1),
      state.capacityKwh,
      state.driving,
      state.reserve,
      state.obd,
      state.lat != null ? state.lat.toFixed(3) : '',
      state.lon != null ? state.lon.toFixed(3) : '',
      state.ocmKey ? 1 : 0,
      state.googleKey ? 1 : 0,
      state.planConsumption.toFixed(1),
      state.recents.map((r) => r.name).join(','),
      state.dest ? `${state.dest.name}|${Math.round(state.dest.arrivalPct)}|${state.dest.status}|${Math.round(state.dest.remainingKm)}` : '',
    ].join('|');
    if (key === lastKey) return;
    lastKey = key;
    setCarState(state);
  } catch {
    // never let the car screen disturb the drive
  } finally {
    busy = false;
  }
}

if (Platform.OS === 'android' && carScreenAvailable) {
  // also runs with the app in the background: every GPS fix of a drive ends up here
  Trip.subscribe(() => {
    sync();
  });
  setInterval(sync, DRIVE_EVERY_MS);
  RNAppState.addEventListener('change', () => {
    sync(true);
  });
  Trip.loadActiveTrip()
    .catch(() => null)
    .then(() => sync(true));
}
