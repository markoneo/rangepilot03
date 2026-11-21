/**
 * Where the car is along the planned route, and how far the battery gets on it:
 * the map on the drive screen draws the route in three parts — reachable above
 * the reserve, reachable only by using the reserve, and out of reach.
 */

export type LatLon = [number, number];

function km(a: LatLon, b: LatLon): number {
  const R = 6371;
  const r = (d: number) => (d * Math.PI) / 180;
  const dLat = r(b[0] - a[0]);
  const dLon = r(b[1] - a[1]);
  const x = Math.sin(dLat / 2) ** 2 + Math.cos(r(a[0])) * Math.cos(r(b[0])) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x));
}

/** Thin a route out to at most `max` points, evenly by distance (keeps both ends). */
export function simplifyRoute(points: LatLon[], max = 400): LatLon[] {
  if (points.length <= max) return points;
  const cum: number[] = [0];
  for (let i = 1; i < points.length; i++) cum.push(cum[i - 1] + km(points[i - 1], points[i]));
  const total = cum[cum.length - 1];
  const out: LatLon[] = [points[0]];
  let j = 0;
  for (let k = 1; k < max - 1; k++) {
    const target = (k * total) / (max - 1);
    while (j < cum.length - 1 && cum[j + 1] < target) j++;
    const p = points[Math.min(j + 1, points.length - 1)];
    const last = out[out.length - 1];
    if (p[0] !== last[0] || p[1] !== last[1]) out.push(p);
  }
  out.push(points[points.length - 1]);
  return out;
}

export interface RouteParts {
  /** from the car to where the reserve starts */
  ok: LatLon[];
  /** driven on the reserve */
  reserve: LatLon[];
  /** the battery does not get this far */
  out: LatLon[];
  /** km of route line still ahead (straight pieces between the points) */
  aheadKm: number;
}

/** Point on the piece a→b at fraction t */
function lerp(a: LatLon, b: LatLon, t: number): LatLon {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
}

/**
 * Split the route ahead of `pos`. `toReserveKm` / `toEmptyKm` are road km the
 * battery lasts until the reserve / until empty; `remainingKm` is the road
 * distance still to go (the thinned line is a little shorter than the road, so
 * the two limits are scaled onto it).
 */
export function splitRoute(
  points: LatLon[],
  pos: LatLon | null,
  remainingKm: number,
  toReserveKm: number,
  toEmptyKm: number
): RouteParts {
  if (points.length < 2) return { ok: [], reserve: [], out: [], aheadKm: 0 };
  // nearest route point to the car; the line ahead starts at the car itself
  let start = 0;
  if (pos) {
    let best = Infinity;
    for (let i = 0; i < points.length; i++) {
      const d = km(pos, points[i]);
      if (d < best) {
        best = d;
        start = i;
      }
    }
    // the nearest point may already be behind the car: step past it when the next one is closer to the end
    if (start < points.length - 1 && km(pos, points[start + 1]) < km(points[start], points[start + 1])) start++;
  }
  const ahead: LatLon[] = pos ? [pos, ...points.slice(start)] : points.slice(start);
  if (ahead.length < 2) return { ok: ahead, reserve: [], out: [], aheadKm: 0 };

  const cum: number[] = [0];
  for (let i = 1; i < ahead.length; i++) cum.push(cum[i - 1] + km(ahead[i - 1], ahead[i]));
  const aheadKm = cum[cum.length - 1];
  const scale = remainingKm > 0 ? aheadKm / remainingKm : 1;
  const a = Math.max(0, Math.min(aheadKm, toReserveKm * scale));
  const b = Math.max(a, Math.min(aheadKm, toEmptyKm * scale));

  const cut = (from: number, to: number): LatLon[] => {
    if (to - from < 1e-6) return [];
    const out: LatLon[] = [];
    for (let i = 1; i < ahead.length; i++) {
      const s0 = cum[i - 1];
      const s1 = cum[i];
      if (s1 < from || s0 > to) continue;
      const len = Math.max(1e-9, s1 - s0);
      const p0 = s0 < from ? lerp(ahead[i - 1], ahead[i], (from - s0) / len) : ahead[i - 1];
      const p1 = s1 > to ? lerp(ahead[i - 1], ahead[i], (to - s0) / len) : ahead[i];
      if (out.length === 0) out.push(p0);
      out.push(p1);
    }
    return out;
  };

  return { ok: cut(0, a), reserve: cut(a, b), out: cut(b, aheadKm), aheadKm };
}

/** Road km from the car to the route point nearest to `target`, or null when it is far from the route. */
export function kmAlongRoute(
  points: LatLon[],
  pos: LatLon | null,
  remainingKm: number,
  target: LatLon,
  maxOffKm = 2
): number | null {
  const parts = splitRoute(points, pos, remainingKm, Infinity, Infinity).ok;
  if (parts.length < 2) return null;
  let best = Infinity;
  let at = 0;
  let run = 0;
  for (let i = 0; i < parts.length; i++) {
    if (i > 0) run += km(parts[i - 1], parts[i]);
    const d = km(parts[i], target);
    if (d < best) {
      best = d;
      at = run;
    }
  }
  if (best > maxOffKm) return null;
  const total = run;
  return total > 0 ? (at / total) * remainingKm : 0;
}
