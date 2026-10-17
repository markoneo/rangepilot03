/**
 * Decides from GPS fixes whether the car is clearly driving again
 * (used while a drive is paused). Pure — easy to test.
 */
import { haversineKm } from './trackCore';

export interface MoveFix {
  lat: number;
  lon: number;
  ts: number;
  speedKmh: number | null;
  accuracy: number | null;
}

const MIN_KMH = 20;
const FAST_FIXES = 3;
const MIN_MOVED_KM = 0.3;

export function createMovingDetector() {
  let origin: MoveFix | null = null;
  let prev: MoveFix | null = null;
  let fast = 0;
  return {
    reset() {
      origin = null;
      prev = null;
      fast = 0;
    },
    /** returns true once the car is clearly moving */
    push(f: MoveFix): boolean {
      if (f.accuracy != null && f.accuracy > 50) return false;
      if (!origin) origin = f;
      let kmh = f.speedKmh != null && f.speedKmh >= 0 ? f.speedKmh : null;
      if (kmh == null && prev && f.ts > prev.ts) {
        kmh = (haversineKm(prev.lat, prev.lon, f.lat, f.lon) / ((f.ts - prev.ts) / 3_600_000)) || 0;
      }
      prev = f;
      fast = kmh != null && kmh >= MIN_KMH && kmh < 250 ? fast + 1 : 0;
      const moved = haversineKm(origin.lat, origin.lon, f.lat, f.lon);
      return fast >= FAST_FIXES || (moved >= MIN_MOVED_KM && (kmh ?? 0) >= 10);
    },
  };
}
