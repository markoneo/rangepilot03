/**
 * One-time move from the old account-based storage to device-only storage.
 *
 * Before, data lived under `u:<userId>:<key>` and trips were also kept in the
 * cloud. Range Pilot now has no accounts, so on the first start of this
 * version we copy everything to plain keys and — if the old sign-in is still
 * on the device — download the trips that only existed in the cloud.
 */
import { kv, readJSON } from './kv';
import { rowToTrip, saveAllTrips, type TripRecord } from './storage';

const DONE_KEY = 'ev_local_mode_v1';
const KEYS = ['ev_car_settings', 'ev_app_state', 'ev_trips', 'ev_prefs', 'ev_charges'];

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T | null> {
  return Promise.race([p, new Promise<null>((r) => setTimeout(() => r(null), ms))]);
}

async function oldUserId(): Promise<{ id: string; client: any } | null> {
  if (!process.env.EXPO_PUBLIC_SUPABASE_URL || !process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY) return null;
  try {
    const { supabase } = await import('./supabase');
    const res = await withTimeout(supabase.auth.getSession(), 4000);
    const id = (res as any)?.data?.session?.user?.id;
    return id ? { id, client: supabase } : null;
  } catch {
    return null;
  }
}

export async function migrateToLocal(): Promise<void> {
  try {
    if (await kv.getItem(DONE_KEY)) return;
    const old = await oldUserId();
    if (!old) {
      await kv.setItem(DONE_KEY, '1');
      return;
    }
    const ns = (key: string) => `u:${old.id}:${key}`;

    // 1. Copy namespaced local data to plain keys (don't overwrite newer data).
    for (const key of KEYS) {
      if (key === 'ev_trips') continue;
      const v = await kv.getItem(ns(key));
      const cur = await kv.getItem(key);
      if (v && (!cur || key === 'ev_charges' || key === 'ev_prefs')) await kv.setItem(key, v);
    }

    // 2. Trips: merge local (namespaced + plain) with whatever is in the cloud.
    const byId: Record<string, TripRecord> = {};
    for (const t of (await readJSON<TripRecord[]>('ev_trips')) ?? []) byId[t.id] = t;
    for (const t of (await readJSON<TripRecord[]>(ns('ev_trips'))) ?? []) byId[t.id] = t;
    let cloudOk = false;
    try {
      const res: any = await withTimeout(
        old.client.from('user_trips').select('*').eq('user_id', old.id),
        8000
      );
      if (res && !res.error && Array.isArray(res.data)) {
        for (const r of res.data) {
          const t = rowToTrip(r);
          byId[t.id] = { ...t, ...(byId[t.id] ?? {}) };
        }
        cloudOk = true;
      }
    } catch {
      // offline — try again next start
    }

    // 3. Car settings from the cloud if the device has none.
    if (!(await kv.getItem('ev_car_settings'))) {
      try {
        const res: any = await withTimeout(
          old.client
            .from('user_car_settings')
            .select('car_name, battery_capacity, consumption, battery_percentage, preset')
            .eq('user_id', old.id)
            .maybeSingle(),
          6000
        );
        const row = res?.data;
        if (row) {
          await kv.setItem(
            'ev_car_settings',
            JSON.stringify({ carName: row.car_name, batteryCapacity: Number(row.battery_capacity) })
          );
          if (!(await kv.getItem('ev_app_state')) && row.consumption != null) {
            await kv.setItem(
              'ev_app_state',
              JSON.stringify({
                consumption: Number(row.consumption),
                batteryPercentage: Number(row.battery_percentage ?? 80),
                preset: row.preset ?? 'custom',
              })
            );
          }
        }
      } catch {
        // ignore
      }
    }

    await saveAllTrips(Object.values(byId));
    // Retry the cloud download on the next starts, but give up after 3 tries.
    const tries = Number((await kv.getItem(DONE_KEY + '_tries')) || '0') + 1;
    await kv.setItem(DONE_KEY + '_tries', String(tries));
    if (cloudOk || tries >= 3) await kv.setItem(DONE_KEY, '1');
  } catch {
    // never block the app
  }
}
