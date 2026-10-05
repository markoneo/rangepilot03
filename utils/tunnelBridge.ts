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
  const url = `${process.env.EXPO_PUBLIC_SUPABASE_URL}/functions/v1/tunnel-distance`;
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY}`,
      },
      body: JSON.stringify({ from, to }),
    });
    if (!res.ok) throw new Error('bad_status');
    const data = (await res.json()) as TunnelResolveResult;
    if (typeof data?.km === 'number' && isFinite(data.km) && data.km >= 0) {
      return data;
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

export async function fetchOutsideTemperatureC(
  lat: number,
  lon: number
): Promise<number | null> {
  const url =
    `${process.env.EXPO_PUBLIC_SUPABASE_URL}/functions/v1/weather-temperature` +
    `?lat=${lat}&lon=${lon}`;
  try {
    const res = await fetch(url, {
      headers: {
        Authorization: `Bearer ${process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY}`,
      },
    });
    if (!res.ok) return null;
    const data = await res.json();
    const t = data?.temperature_c;
    return typeof t === 'number' && isFinite(t) ? t : null;
  } catch {
    return null;
  }
}

export async function logTunnelGap(payload: {
  trip_id: string;
  started_at: string;
  ended_at: string;
  last_coord_lat: number;
  last_coord_lon: number;
  first_recovered_lat: number;
  first_recovered_lon: number;
  last_speed_kmh: number;
  bridged_km: number;
  straight_line_km: number | null;
  road_api_km: number | null;
  final_km_used: number;
  source: string;
}) {
  const url = `${process.env.EXPO_PUBLIC_SUPABASE_URL}/rest/v1/trip_gps_gaps`;
  try {
    await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: String(process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY),
        Authorization: `Bearer ${process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY}`,
        Prefer: 'return=minimal',
      },
      body: JSON.stringify({
        device_id: getDeviceId(),
        ...payload,
      }),
    });
  } catch {
    // telemetry only
  }
}
