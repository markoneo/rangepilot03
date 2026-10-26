import { Platform } from 'react-native';

const DEVICE_ID_KEY = 'range-pilot-device-id';
const memoryStore: Record<string, string> = {};

const hasLocalStorage =
  Platform.OS === 'web' &&
  typeof globalThis !== 'undefined' &&
  typeof (globalThis as any).localStorage !== 'undefined';

function readLocal(key: string): string | null {
  if (hasLocalStorage) {
    try {
      return (globalThis as any).localStorage.getItem(key);
    } catch {
      return memoryStore[key] ?? null;
    }
  }
  return memoryStore[key] ?? null;
}

function writeLocal(key: string, value: string) {
  memoryStore[key] = value;
  if (hasLocalStorage) {
    try {
      (globalThis as any).localStorage.setItem(key, value);
    } catch {
      // ignore
    }
  }
}

function randomId(): string {
  const g: any = globalThis as any;
  if (g.crypto?.randomUUID) return g.crypto.randomUUID();
  return (
    Math.random().toString(36).slice(2) +
    Date.now().toString(36) +
    Math.random().toString(36).slice(2)
  );
}

export function getDeviceId(): string {
  const existing = readLocal(DEVICE_ID_KEY);
  if (existing) return existing;
  const id = randomId();
  writeLocal(DEVICE_ID_KEY, id);
  return id;
}

export type TunnelResolveResult = {
  km: number;
  straight_line_km: number;
  road_api_km: number | null;
  source: 'road_api' | 'haversine';
};

export async function resolveTunnelDistance(
  from: { lat: number; lon: number },
  to: { lat: number; lon: number },
  straightLineFallbackKm: number
): Promise<TunnelResolveResult> {
  // Road distance straight from the routing services (Google Routes, then the
  // free OSRM server) — no own server needed.
  try {
    const { computeRoute } = await import('./maps');
    const r = await computeRoute(from, to);
    if (r && isFinite(r.km) && r.km >= 0) {
      return { km: r.km, straight_line_km: straightLineFallbackKm, road_api_km: r.km, source: 'road_api' };
    }
  } catch {
    // fall through
  }
  return {
    km: straightLineFallbackKm,
    straight_line_km: straightLineFallbackKm,
    road_api_km: null,
    source: 'haversine',
  };
}

export async function fetchOutsideTemperatureC(lat: number, lon: number): Promise<number | null> {
  const url =
    `https://api.open-meteo.com/v1/forecast?latitude=${lat.toFixed(3)}&longitude=${lon.toFixed(3)}` +
    `&current=temperature_2m`;
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const data = await res.json();
    const t = data?.current?.temperature_2m;
    return typeof t === 'number' && isFinite(t) ? t : null;
  } catch {
    return null;
  }
}

/** Formerly logged GPS gaps to the server; everything stays on the device now. */
export async function logTunnelGap(_payload: Record<string, unknown>): Promise<void> {}
