import { AppState as RNAppState, Platform } from 'react-native';
import * as Trip from './tripTracker';
import { loadAppState, loadCarSettings, loadPrefs, savePrefs } from './storage';
import { rangeFor } from './trackCore';
import { carScreenAvailable, setCarState, takeCarReserve, type CarState } from '../modules/range-pilot-car';

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
    snap = Trip.getSnapshot();
    trip = Trip.getTrip();
    let state: CarState;
    if (snap && trip) {
      const fix = trip.lastFix;
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
        ts: now,
        ocmKey: process.env.EXPO_PUBLIC_OCM_KEY || '',
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
        ts: now,
        ocmKey: process.env.EXPO_PUBLIC_OCM_KEY || '',
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
