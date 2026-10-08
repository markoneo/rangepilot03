/**
 * Learned consumption by season (outside temperature) × driving style.
 *
 * Built from finished trips that have a real (battery-based) consumption.
 * Recent trips and longer trips count more. A cell is only trusted once it
 * has enough evidence; otherwise we fall back to the same style in any
 * season, and finally to the preset value.
 */
import { TripRecord } from './storage';

export type Style = 'city' | 'mixed' | 'highway';
export type Season = 'cold' | 'mild' | 'warm';

export const STYLES: { key: Style; label: string; hint: string }[] = [
  { key: 'city', label: 'City', hint: 'under 50 km/h avg' },
  { key: 'mixed', label: 'Mixed', hint: '50–80 km/h avg' },
  { key: 'highway', label: 'Highway', hint: 'over 80 km/h avg' },
];

export const SEASONS: { key: Season; label: string; hint: string }[] = [
  { key: 'cold', label: 'Cold', hint: 'below 10°C' },
  { key: 'mild', label: 'Mild', hint: '10–20°C' },
  { key: 'warm', label: 'Warm', hint: 'above 20°C' },
];

export function seasonOf(tempC: number | null | undefined): Season | null {
  if (tempC == null || !isFinite(tempC)) return null;
  if (tempC < 10) return 'cold';
  if (tempC <= 20) return 'mild';
  return 'warm';
}

export function styleOf(avgSpeedKmh: number | null | undefined): Style | null {
  if (avgSpeedKmh == null || !isFinite(avgSpeedKmh) || avgSpeedKmh <= 0) return null;
  if (avgSpeedKmh < 50) return 'city';
  if (avgSpeedKmh <= 80) return 'mixed';
  return 'highway';
}

export interface Cell {
  consumption: number;
  trips: number;
  km: number;
}

export type Profile = Record<Style, Record<Season, Cell | null>> & {
  byStyle: Record<Style, Cell | null>;
};

const MIN_TRIP_KM = 10;
const HALF_LIFE_DAYS = 90;

function tripTemp(t: TripRecord): number | null {
  if (t.minTemperatureC != null && t.maxTemperatureC != null) return (t.minTemperatureC + t.maxTemperatureC) / 2;
  return t.maxTemperatureC ?? t.minTemperatureC ?? null;
}

function tripSpeed(t: TripRecord): number | null {
  const secs = t.movingSeconds && t.movingSeconds > 60 ? t.movingSeconds : t.durationSeconds;
  return secs > 0 ? t.distanceKm / (secs / 3600) : null;
}

function trusted(c: { w: number; trips: number; km: number }) {
  return c.trips >= 2 || c.km >= 60;
}

export function buildProfile(trips: TripRecord[], now = Date.now()): Profile {
  type Acc = { sum: number; w: number; trips: number; km: number };
  const blank = (): Acc => ({ sum: 0, w: 0, trips: 0, km: 0 });
  const cells: Record<string, Acc> = {};
  const styles: Record<string, Acc> = {};

  for (const t of trips) {
    if (t.realConsumption == null || t.distanceKm < MIN_TRIP_KM) continue;
    if (t.realConsumption < 5 || t.realConsumption > 50) continue;
    const style = styleOf(tripSpeed(t));
    if (!style) continue;
    const ageDays = Math.max(0, (now - new Date(t.startedAt).getTime()) / 86400000);
    const w = t.distanceKm * Math.pow(0.5, ageDays / HALF_LIFE_DAYS);
    const add = (a: Acc) => {
      a.sum += t.realConsumption! * w;
      a.w += w;
      a.trips += 1;
      a.km += t.distanceKm;
    };
    add((styles[style] ??= blank()));
    const season = seasonOf(tripTemp(t));
    if (season) add((cells[`${style}:${season}`] ??= blank()));
  }

  const toCell = (a?: Acc): Cell | null =>
    a && a.w > 0 && trusted(a)
      ? { consumption: Math.round((a.sum / a.w) * 10) / 10, trips: a.trips, km: Math.round(a.km) }
      : null;

  const p: any = { byStyle: {} };
  for (const s of STYLES) {
    p[s.key] = {};
    for (const se of SEASONS) p[s.key][se.key] = toCell(cells[`${s.key}:${se.key}`]);
    p.byStyle[s.key] = toCell(styles[s.key]);
  }
  return p as Profile;
}

export type Suggestion = { value: number; source: 'season' | 'style' } | null;

/** Best learned value for a driving style, in today's season when known. */
export function suggest(p: Profile, style: Style, tempC: number | null): Suggestion {
  const season = seasonOf(tempC);
  const cell = season ? p[style][season] : null;
  if (cell) return { value: cell.consumption, source: 'season' };
  const any = p.byStyle[style];
  if (any) return { value: any.consumption, source: 'style' };
  return null;
}
