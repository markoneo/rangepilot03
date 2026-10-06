/**
 * Address search, routing and elevation for the "Can I make it?" check.
 *
 * Google (Places API (New) + Routes API) when EXPO_PUBLIC_GOOGLE_MAPS_KEY is set
 * and accepted; otherwise free fallbacks: Photon (OpenStreetMap search) and
 * OSRM (routing). Elevation comes from Open-Meteo (free, no key).
 */
import { readJSON, writeJSON } from './kv';

const GKEY = (process.env.EXPO_PUBLIC_GOOGLE_MAPS_KEY as string | undefined) || '';
let googleBlocked = false;

export interface PlaceSuggestion {
  id: string;
  title: string;
  subtitle: string;
  source: 'google' | 'osm' | 'recent';
  lat?: number;
  lon?: number;
}

export interface Place {
  name: string;
  address: string;
  lat: number;
  lon: number;
}

export interface RouteInfo {
  km: number;
  minutes: number;
  points: [number, number][];
  source: 'google' | 'osrm';
}

export interface Elevation {
  climbM: number;
  descentM: number;
  netM: number;
}

export function usingGoogle(): boolean {
  return !!GKEY && !googleBlocked;
}

export function newSessionToken(): string {
  const g: any = globalThis as any;
  if (g.crypto?.randomUUID) return g.crypto.randomUUID();
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });
}

async function googleFetch(url: string, init: RequestInit): Promise<any | null> {
  if (!usingGoogle()) return null;
  try {
    const res = await fetch(url, init);
    if (res.status === 403 || res.status === 401) {
      googleBlocked = true; // key restricted / API not enabled → use free maps
      return null;
    }
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

// ── Search ────────────────────────────────────────────────────────────────

export async function searchPlaces(
  query: string,
  near: { lat: number; lon: number } | null,
  sessionToken: string
): Promise<PlaceSuggestion[]> {
  const q = query.trim();
  if (q.length < 2) return [];

  const g = await googleFetch('https://places.googleapis.com/v1/places:autocomplete', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Goog-Api-Key': GKEY },
    body: JSON.stringify({
      input: q,
      sessionToken,
      ...(near
        ? { locationBias: { circle: { center: { latitude: near.lat, longitude: near.lon }, radius: 50000 } } }
        : {}),
    }),
  });
  if (g && Array.isArray(g.suggestions)) {
    return g.suggestions
      .map((s: any) => s.placePrediction)
      .filter(Boolean)
      .slice(0, 6)
      .map((p: any) => ({
        id: p.placeId,
        title: p.structuredFormat?.mainText?.text ?? p.text?.text ?? '',
        subtitle: p.structuredFormat?.secondaryText?.text ?? '',
        source: 'google' as const,
      }));
  }

  // Free fallback: Photon (OpenStreetMap)
  try {
    const bias = near ? `&lat=${near.lat}&lon=${near.lon}` : '';
    const res = await fetch(
      `https://photon.komoot.io/api/?q=${encodeURIComponent(q)}&limit=6${bias}`
    );
    const j = await res.json();
    return (j.features || []).map((f: any, i: number) => {
      const p = f.properties || {};
      const title = p.name || [p.street, p.housenumber].filter(Boolean).join(' ') || p.city || q;
      const subtitle = [p.street && p.name ? p.street : null, p.city, p.country]
        .filter(Boolean)
        .join(', ');
      return {
        id: `osm-${p.osm_id ?? i}`,
        title,
        subtitle,
        source: 'osm' as const,
        lat: f.geometry?.coordinates?.[1],
        lon: f.geometry?.coordinates?.[0],
      };
    });
  } catch {
    return [];
  }
}

export async function resolvePlace(s: PlaceSuggestion, sessionToken: string): Promise<Place | null> {
  if (s.lat != null && s.lon != null) {
    return { name: s.title, address: s.subtitle, lat: s.lat, lon: s.lon };
  }
  if (s.source !== 'google') return null;
  const j = await googleFetch(
    `https://places.googleapis.com/v1/places/${encodeURIComponent(s.id)}?sessionToken=${sessionToken}`,
    {
      headers: {
        'X-Goog-Api-Key': GKEY,
        'X-Goog-FieldMask': 'location,displayName,formattedAddress',
      },
    }
  );
  if (!j?.location) return null;
  return {
    name: j.displayName?.text ?? s.title,
    address: j.formattedAddress ?? s.subtitle,
    lat: j.location.latitude,
    lon: j.location.longitude,
  };
}

// ── Recent places ─────────────────────────────────────────────────────────

const RECENT_KEY = 'ev_recent_places';

export async function loadRecentPlaces(): Promise<Place[]> {
  return (await readJSON<Place[]>(RECENT_KEY)) ?? [];
}

export async function rememberPlace(p: Place): Promise<void> {
  const list = await loadRecentPlaces();
  const next = [p, ...list.filter((x) => Math.abs(x.lat - p.lat) > 1e-4 || Math.abs(x.lon - p.lon) > 1e-4)];
  await writeJSON(RECENT_KEY, next.slice(0, 8));
}

// ── Routing ───────────────────────────────────────────────────────────────

export function decodePolyline(str: string): [number, number][] {
  let index = 0;
  let lat = 0;
  let lng = 0;
  const out: [number, number][] = [];
  while (index < str.length) {
    let b: number;
    let shift = 0;
    let result = 0;
    do {
      b = str.charCodeAt(index++) - 63;
      result |= (b & 0x1f) << shift;
      shift += 5;
    } while (b >= 0x20);
    lat += result & 1 ? ~(result >> 1) : result >> 1;
    shift = 0;
    result = 0;
    do {
      b = str.charCodeAt(index++) - 63;
      result |= (b & 0x1f) << shift;
      shift += 5;
    } while (b >= 0x20);
    lng += result & 1 ? ~(result >> 1) : result >> 1;
    out.push([lat / 1e5, lng / 1e5]);
  }
  return out;
}

export async function computeRoute(
  from: { lat: number; lon: number },
  to: { lat: number; lon: number }
): Promise<RouteInfo | null> {
  const g = await googleFetch('https://routes.googleapis.com/directions/v2:computeRoutes', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Goog-Api-Key': GKEY,
      'X-Goog-FieldMask': 'routes.distanceMeters,routes.duration,routes.polyline.encodedPolyline',
    },
    body: JSON.stringify({
      origin: { location: { latLng: { latitude: from.lat, longitude: from.lon } } },
      destination: { location: { latLng: { latitude: to.lat, longitude: to.lon } } },
      travelMode: 'DRIVE',
      routingPreference: 'TRAFFIC_AWARE',
    }),
  });
  const r = g?.routes?.[0];
  if (r?.distanceMeters != null) {
    const secs = parseFloat(String(r.duration ?? '0').replace('s', '')) || 0;
    return {
      km: r.distanceMeters / 1000,
      minutes: secs / 60,
      points: r.polyline?.encodedPolyline ? decodePolyline(r.polyline.encodedPolyline) : [],
      source: 'google',
    };
  }
  try {
    const res = await fetch(
      `https://router.project-osrm.org/route/v1/driving/${from.lon},${from.lat};${to.lon},${to.lat}?overview=full&geometries=polyline`
    );
    const j = await res.json();
    const o = j.routes?.[0];
    if (!o) return null;
    return {
      km: o.distance / 1000,
      minutes: o.duration / 60,
      points: decodePolyline(o.geometry),
      source: 'osrm',
    };
  } catch {
    return null;
  }
}

export async function routeElevation(points: [number, number][]): Promise<Elevation | null> {
  if (points.length < 2) return null;
  const n = Math.min(100, points.length);
  const sample: [number, number][] = [];
  for (let i = 0; i < n; i++) sample.push(points[Math.round((i * (points.length - 1)) / (n - 1))]);
  try {
    const lat = sample.map((p) => p[0].toFixed(5)).join(',');
    const lon = sample.map((p) => p[1].toFixed(5)).join(',');
    const res = await fetch(`https://api.open-meteo.com/v1/elevation?latitude=${lat}&longitude=${lon}`);
    const j = await res.json();
    const el: number[] = j.elevation;
    if (!Array.isArray(el) || el.length < 2) return null;
    let climb = 0;
    let descent = 0;
    for (let i = 1; i < el.length; i++) {
      const d = el[i] - el[i - 1];
      if (d > 0) climb += d;
      else descent -= d;
    }
    return { climbM: Math.round(climb), descentM: Math.round(descent), netM: Math.round(el[el.length - 1] - el[0]) };
  } catch {
    return null;
  }
}

// ── Energy estimate ───────────────────────────────────────────────────────

export type ArrivalStatus = 'ok' | 'tight' | 'no';

export interface ArrivalEstimate {
  arrivalPct: number;
  needKwh: number;
  elevKwh: number;
  status: ArrivalStatus;
  /** max avg consumption that still arrives with the reserve (null if impossible) */
  maxConsumption: number | null;
  /** battery % back at the start after a return trip without charging */
  roundTripPct: number;
  rangeAtArrivalKm: number;
}

const VEHICLE_MASS_KG = 2100;

/**
 * Average consumption already contains "normal" ups and downs, so only the
 * net height difference is added: going up costs potential energy (÷ 90 %
 * drivetrain efficiency), going down gives back ~60 % through regen.
 */
export function elevationKwh(netM: number): number {
  const kwh = (VEHICLE_MASS_KG * 9.81 * netM) / 3.6e6;
  return netM >= 0 ? kwh / 0.9 : kwh * 0.6;
}

export function estimateArrival(p: {
  capacityKwh: number;
  batteryPct: number;
  consumption: number;
  reservePct: number;
  km: number;
  netM: number;
}): ArrivalEstimate {
  const elevKwh = elevationKwh(p.netM);
  const needKwh = Math.max(0, (p.km * p.consumption) / 100 + elevKwh);
  const arrivalPct = p.batteryPct - (needKwh / p.capacityKwh) * 100;
  const backKwh = Math.max(0, (p.km * p.consumption) / 100 + elevationKwh(-p.netM));
  const roundTripPct = arrivalPct - (backKwh / p.capacityKwh) * 100;
  const usableForTrip = (p.capacityKwh * (p.batteryPct - p.reservePct)) / 100 - elevKwh;
  const maxConsumption = p.km > 0 && usableForTrip > 0 ? (usableForTrip / p.km) * 100 : null;
  const status: ArrivalStatus =
    arrivalPct >= p.reservePct + 5 ? 'ok' : arrivalPct >= Math.max(0, p.reservePct) ? 'tight' : 'no';
  return {
    arrivalPct,
    needKwh,
    elevKwh,
    status,
    maxConsumption,
    roundTripPct,
    rangeAtArrivalKm: p.consumption > 0 ? Math.max(0, (p.capacityKwh * arrivalPct) / p.consumption) : 0,
  };
}
