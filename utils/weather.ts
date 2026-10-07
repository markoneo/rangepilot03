import { fetchOutsideTemperatureC } from './tunnelBridge';

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
