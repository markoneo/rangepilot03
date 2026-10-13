/**
 * Terrain elevation from a digital elevation model (Open-Meteo, Copernicus
 * 90 m DEM) instead of GPS altitude. Phone/browser GPS altitude is noisy
 * (±10–30 m, often missing on web) and on Android it's height above the
 * ellipsoid (~45 m too high in Slovenia), so summed climb was way off.
 */
const BATCH = 100;

async function fetchBatch(pts: [number, number][], signal: AbortSignal): Promise<number[] | null> {
  const lat = pts.map((p) => p[0].toFixed(5)).join(',');
  const lon = pts.map((p) => p[1].toFixed(5)).join(',');
  const res = await fetch(`https://api.open-meteo.com/v1/elevation?latitude=${lat}&longitude=${lon}`, { signal });
  if (!res.ok) return null;
  const j = await res.json();
  const el = j?.elevation;
  return Array.isArray(el) && el.length === pts.length && el.every((x: any) => typeof x === 'number') ? el : null;
}

export async function demElevations(points: [number, number][], timeoutMs = 8000): Promise<number[] | null> {
  if (points.length < 2) return null;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const batches: [number, number][][] = [];
    for (let i = 0; i < points.length; i += BATCH) batches.push(points.slice(i, i + BATCH));
    const out = await Promise.all(batches.map((b) => fetchBatch(b, ctrl.signal)));
    if (out.some((x) => !x)) return null;
    return out.flat() as number[];
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

export interface ElevationStats {
  gainM: number;
  lossM: number;
  minM: number;
  maxM: number;
  netM: number;
}

/**
 * Climb/descent with light smoothing: a 3-point median removes single spikes
 * (bridges over valleys, DEM pixels), and a small hysteresis stops flat-road
 * wobble from adding up.
 */
export function elevationStats(el: number[], hysteresisM = 3): ElevationStats | null {
  if (el.length < 2) return null;
  const sm = el.map((_, i) => {
    if (i === 0 || i === el.length - 1) return el[i];
    const w = [el[i - 1], el[i], el[i + 1]].sort((a, b) => a - b);
    return w[1];
  });
  let gain = 0;
  let loss = 0;
  let ref = sm[0];
  for (let i = 1; i < sm.length; i++) {
    const d = sm[i] - ref;
    if (d >= hysteresisM) {
      gain += d;
      ref = sm[i];
    } else if (d <= -hysteresisM) {
      loss -= d;
      ref = sm[i];
    }
  }
  return {
    gainM: Math.round(gain),
    lossM: Math.round(loss),
    minM: Math.round(Math.min(...sm)),
    maxM: Math.round(Math.max(...sm)),
    netM: Math.round(el[el.length - 1] - el[0]),
  };
}

export async function trackElevationStats(points: [number, number][]): Promise<ElevationStats | null> {
  const el = await demElevations(points);
  return el ? elevationStats(el) : null;
}
