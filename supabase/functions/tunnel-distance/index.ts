const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

type Coord = { lat: number; lon: number };

type RequestBody = {
  from: Coord;
  to: Coord;
};

function haversineKm(a: Coord, b: Coord): number {
  const R = 6371;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lon - a.lon);
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

async function googleDistanceKm(
  from: Coord,
  to: Coord,
  apiKey: string,
): Promise<{ km: number | null; status: string; error: string | null }> {
  const url =
    `https://maps.googleapis.com/maps/api/directions/json` +
    `?origin=${from.lat},${from.lon}` +
    `&destination=${to.lat},${to.lon}` +
    `&mode=driving&key=${apiKey}`;
  try {
    const referer = Deno.env.get("GOOGLE_MAPS_REFERER") ?? "";
    const headers: Record<string, string> = {};
    if (referer) headers["Referer"] = referer;
    const res = await fetch(url, { headers });
    if (!res.ok) return { km: null, status: `http_${res.status}`, error: await res.text() };
    const data = await res.json();
    const status = data?.status ?? "UNKNOWN";
    const route = data?.routes?.[0];
    const leg = route?.legs?.[0];
    const meters = leg?.distance?.value;
    if (typeof meters !== "number") {
      return { km: null, status, error: data?.error_message ?? null };
    }
    return { km: meters / 1000, status, error: null };
  } catch (e) {
    return { km: null, status: "fetch_error", error: String(e) };
  }
}

// Free fallback (public OSRM demo server, fair-use). Used when no Google key
// is configured or Google fails, so GPS-gap distances follow the road.
async function osrmDistanceKm(from: Coord, to: Coord): Promise<number | null> {
  const url =
    `https://router.project-osrm.org/route/v1/driving/` +
    `${from.lon},${from.lat};${to.lon},${to.lat}?overview=false&alternatives=false`;
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 6000);
    const res = await fetch(url, { signal: ctrl.signal });
    clearTimeout(timer);
    if (!res.ok) return null;
    const data = await res.json();
    const meters = data?.routes?.[0]?.distance;
    return typeof meters === "number" ? meters / 1000 : null;
  } catch {
    return null;
  }
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  try {
    if (req.method !== "POST") {
      return new Response(JSON.stringify({ error: "method_not_allowed" }), {
        status: 405,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const body = (await req.json()) as RequestBody;
    const from = body?.from;
    const to = body?.to;
    if (
      !from || !to ||
      typeof from.lat !== "number" || typeof from.lon !== "number" ||
      typeof to.lat !== "number" || typeof to.lon !== "number"
    ) {
      return new Response(JSON.stringify({ error: "invalid_payload" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const apiKey = Deno.env.get("GOOGLE_MAPS_API_KEY") ?? "";
    const straight = haversineKm(from, to);

    let roadKm: number | null = null;
    let source: "road_api" | "haversine" = "haversine";
    let googleStatus: string | null = null;
    let googleError: string | null = null;
    const hasKey = apiKey.length > 0;
    if (hasKey) {
      const g = await googleDistanceKm(from, to, apiKey);
      googleStatus = g.status;
      googleError = g.error;
      roadKm = g.km;
      if (roadKm !== null) source = "road_api";
    }

    if (roadKm === null) {
      const o = await osrmDistanceKm(from, to);
      if (o !== null) {
        roadKm = o;
        source = "road_api";
      }
    }

    const km = roadKm ?? straight;

    return new Response(
      JSON.stringify({
        km,
        straight_line_km: straight,
        road_api_km: roadKm,
        source,
        has_key: hasKey,
        google_status: googleStatus,
        google_error: googleError,
      }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      },
    );
  } catch (err) {
    return new Response(
      JSON.stringify({ error: "server_error", message: String(err) }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      },
    );
  }
});
