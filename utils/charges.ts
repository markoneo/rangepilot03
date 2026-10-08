/**
 * Charging log — stored on the phone (per user). Each charge records how much
 * energy went in and what it cost, so trips can be priced with the real
 * average price per kWh instead of a fixed number.
 */
import { readJSON, writeJSON } from './kv';
import { ensureUserLoaded, userKey } from './storage';

export type ChargeType = 'home' | 'ac' | 'dc';

export const CHARGE_TYPES: { key: ChargeType; label: string }[] = [
  { key: 'home', label: 'Home' },
  { key: 'ac', label: 'Public AC' },
  { key: 'dc', label: 'Fast DC' },
];

export interface ChargeRecord {
  id: string;
  date: string;
  fromPct: number;
  toPct: number;
  kwh: number;
  cost: number;
  type: ChargeType;
  place?: string;
}

const KEY = 'ev_charges';

export async function loadCharges(): Promise<ChargeRecord[]> {
  await ensureUserLoaded();
  const list = (await readJSON<ChargeRecord[]>(userKey(KEY))) ?? [];
  return [...list].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
}

export async function saveCharge(c: ChargeRecord): Promise<void> {
  const list = await loadCharges();
  await writeJSON(userKey(KEY), [c, ...list.filter((x) => x.id !== c.id)]);
}

export async function deleteCharge(id: string): Promise<void> {
  const list = await loadCharges();
  await writeJSON(userKey(KEY), list.filter((x) => x.id !== id));
}

export function pricePerKwh(c: ChargeRecord): number {
  return c.kwh > 0 ? c.cost / c.kwh : 0;
}

/**
 * Your real average price per kWh: recent charges count more (60-day
 * half-life), bigger charges count more. Free charging counts too (it lowers
 * the average). Charges older than a year are ignored.
 */
export function averagePrice(charges: ChargeRecord[], now = Date.now()): number | null {
  let sum = 0;
  let w = 0;
  for (const c of charges) {
    if (!(c.kwh > 0) || c.cost < 0) continue;
    const ageDays = (now - new Date(c.date).getTime()) / 86400000;
    if (ageDays > 365) continue;
    const weight = c.kwh * Math.pow(0.5, Math.max(0, ageDays) / 60);
    sum += c.cost * weight / c.kwh;
    w += weight;
  }
  return w > 0 ? sum / w : null;
}

export async function currentAveragePrice(): Promise<number | null> {
  return averagePrice(await loadCharges());
}
