import { fetchOutsideTemperatureC } from './tunnelBridge';
import { kv } from './kv';

/** Current outside temperature (°C). Open-Meteo directly, Supabase function as fallback. */
export async function getOutsideTempC(lat: number, lon: number): Promise<number | null> {
  try {
    const res = await fetch(
      `https://api.open-meteo.com/v1/forecast?latitude=${lat.toFixed(3)}&longitude=${lon.toFixed(3)}&current=temperature_2m`
    );
    if (res.ok) {
      const j = await res.json();
      const t = j?.current?.temperature_2m;
      if (typeof t === 'number' && isFinite(t)) return t;
    }
  } catch {
    // fall through
  }
  return fetchOutsideTemperatureC(lat, lon);
}

export const COLD_LIMIT_C = 10;

/** The cold-weather pop-up is shown once per day; after that only the chip. */
const COLD_SEEN_KEY = 'ev_cold_note_seen';
function today() {
  const d = new Date();
  return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
}
export async function coldNoteSeenToday(): Promise<boolean> {
  try {
    return (await kv.getItem(COLD_SEEN_KEY)) === today();
  } catch {
    return false;
  }
}
export async function markColdNoteSeen() {
  try {
    await kv.setItem(COLD_SEEN_KEY, today());
  } catch {
    // ignore
  }
}
