/**
 * Charging stations from Open Charge Map (openchargemap.org).
 * Called straight from the device; needs a free API key in
 * EXPO_PUBLIC_OCM_KEY. Without a key (or offline) sample data is shown so
 * the screen can be previewed.
 */
import { haversineKm } from './trackCore';

export type Plug = 'CCS' | 'Type 2' | 'CHAdeMO' | 'Tesla' | 'Type 1' | 'Other';

export interface Charger {
  id: string;
  name: string;
  operator: string | null;
  address: string;
  lat: number;
  lon: number;
  /** straight-line km from the search point */
  distanceKm: number;
  /** highest power of any connector */
  powerKw: number | null;
  dc: boolean;
  plugs: Plug[];
  points: number | null;
  operational: boolean | null;
}

// Open Charge Map connection type ids → plug names
const PLUG_BY_ID: Record<number, Plug> = {
  33: 'CCS',
  32: 'CCS',
  25: 'Type 2',
  1036: 'Type 2',
  2: 'CHAdeMO',
  27: 'Tesla',
  30: 'Tesla',
  8: 'Tesla',
  1: 'Type 1',
};

function mapPoi(p: any, from: { lat: number; lon: number }): Charger | null {
  const a = p?.AddressInfo;
  if (!a || typeof a.Latitude !== 'number' || typeof a.Longitude !== 'number') return null;
  const conns: any[] = Array.isArray(p.Connections) ? p.Connections : [];
  const plugs = Array.from(
    new Set(conns.map((c) => PLUG_BY_ID[c?.ConnectionTypeID] ?? 'Other'))
  ).filter((x) => x !== 'Other') as Plug[];
  const powers = conns.map((c) => Number(c?.PowerKW)).filter((n) => isFinite(n) && n > 0);
  const powerKw = powers.length ? Math.max(...powers) : null;
  const dc = conns.some((c) => c?.CurrentTypeID === 30) || (powerKw != null && powerKw >= 50);
  const status = p?.StatusType;
  return {
    id: String(p.ID),
    name: a.Title || 'Charging station',
    operator: p?.OperatorInfo?.Title ?? null,
    address: [a.AddressLine1, a.Town].filter(Boolean).join(', '),
    lat: a.Latitude,
    lon: a.Longitude,
    distanceKm: haversineKm(from.lat, from.lon, a.Latitude, a.Longitude),
    powerKw,
    dc,
    plugs: plugs.length ? plugs : ['Other'],
    points: typeof p.NumberOfPoints === 'number' ? p.NumberOfPoints : null,
    operational: status && typeof status.IsOperational === 'boolean' ? status.IsOperational : null,
  };
}

export async function fetchChargers(
  at: { lat: number; lon: number },
  radiusKm = 40,
  max = 60
): Promise<{ chargers: Charger[]; sample: boolean }> {
  const key = process.env.EXPO_PUBLIC_OCM_KEY;
  if (!key) return { chargers: sampleChargers(at), sample: true };
  const url =
    `https://api.openchargemap.io/v3/poi/?output=json&latitude=${at.lat}&longitude=${at.lon}` +
    `&distance=${radiusKm}&distanceunit=KM&maxresults=${max}&compact=true&verbose=false&key=${key}`;
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 10000);
    const res = await fetch(url, { signal: ctrl.signal });
    clearTimeout(timer);
    if (!res.ok) throw new Error(String(res.status));
    const data = await res.json();
    const list = (Array.isArray(data) ? data : [])
      .map((p) => mapPoi(p, at))
      .filter((c): c is Charger => !!c && c.operational !== false)
      .sort((a, b) => a.distanceKm - b.distanceKm);
    return { chargers: list, sample: false };
  } catch {
    return { chargers: [], sample: false };
  }
}

/** Battery % on arrival (roads ≈ 25% longer than straight line). */
export function arrivalPct(
  c: Charger,
  batteryPct: number,
  capacityKwh: number,
  consumption: number
): number {
  const roadKm = c.distanceKm * 1.25;
  const used = capacityKwh > 0 ? ((roadKm * consumption) / 100 / capacityKwh) * 100 : 0;
  return batteryPct - used;
}

export function navigationUrl(c: Charger): string {
  return `https://www.google.com/maps/dir/?api=1&destination=${c.lat},${c.lon}&travelmode=driving`;
}

function sampleChargers(at: { lat: number; lon: number }): Charger[] {
  const s = (
    id: string,
    name: string,
    operator: string,
    address: string,
    dLat: number,
    dLon: number,
    powerKw: number,
    dc: boolean,
    plugs: Plug[],
    points: number
  ): Charger => {
    const lat = at.lat + dLat;
    const lon = at.lon + dLon;
    return {
      id, name, operator, address, lat, lon, powerKw, dc, plugs, points, operational: true,
      distanceKm: haversineKm(at.lat, at.lon, lat, lon),
    };
  };
  return [
    s('s1', 'Petrol Kozina', 'Petrol', 'Bazoviška cesta, Kozina', 0.012, 0.01, 50, true, ['CCS', 'CHAdeMO', 'Type 2'], 2),
    s('s2', 'Ionity Lokev', 'IONITY', 'A1 Lokev', 0.03, -0.06, 350, true, ['CCS'], 6),
    s('s3', 'Gremo na elektriko Sežana', 'Elektro Primorska', 'Partizanska cesta, Sežana', 0.07, -0.09, 22, false, ['Type 2'], 2),
    s('s4', 'Tesla Supercharger Postojna', 'Tesla', 'Tržaška cesta, Postojna', 0.13, 0.25, 250, true, ['CCS', 'Tesla'], 8),
    s('s5', 'Lidl Koper', 'Lidl', 'Ankaranska cesta, Koper', -0.1, -0.12, 50, true, ['CCS', 'Type 2'], 2),
    s('s6', 'MOL Plug Divača', 'MOL', 'Kraška cesta, Divača', 0.06, 0.04, 150, true, ['CCS', 'CHAdeMO'], 4),
    s('s7', 'Hotel Lipica', 'Lipica', 'Lipica 5', 0.04, -0.02, 11, false, ['Type 2'], 2),
  ].sort((a, b) => a.distanceKm - b.distanceKm);
}
