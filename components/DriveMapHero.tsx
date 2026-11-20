import { useEffect, useMemo, useRef, useState } from 'react';
import { Linking, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import Svg, { Circle } from 'react-native-svg';
import { Navigation } from 'lucide-react-native';
import { C, F } from '@/constants/theme';
import { DriveMap } from '@/components/DriveMap';
import { ringColor } from '@/utils/ringColor';
import { estimateArrival } from '@/utils/maps';
import { fetchChargers, type Charger } from '@/utils/chargers';
import { destinationRemainingKm, type TripState } from '@/utils/trackCore';
import { kmAlongRoute, splitRoute, type LatLon } from '@/utils/routeProgress';
import type { DriveMapData } from '@/utils/driveMapHtml';
import type { Snapshot } from '@/utils/tripTracker';
import { tap } from '@/components/ui';

const MAP_HEIGHT = 340;

/**
 * The top of the drive screen while a destination is set: the route on a map
 * (green while the battery lasts, amber on the reserve, dotted red beyond),
 * the range in a small dial, the battery now and on arrival, and Navigate.
 */
export function DriveMapHero({ trip, snap, paused }: { trip: TripState; snap: Snapshot; paused: boolean }) {
  const dest = trip.destination!;
  const points = (dest.points ?? []) as LatLon[];
  const remaining = destinationRemainingKm(trip) ?? dest.routeKm;
  const frac = dest.routeKm > 0 ? remaining / dest.routeKm : 0;
  const consumption = snap.obdLive ? snap.flatConsumption : snap.consumption;
  const est = estimateArrival({
    capacityKwh: trip.batteryCapacity,
    batteryPct: snap.battery,
    consumption,
    reservePct: snap.reservePercent,
    km: remaining,
    netM: dest.netM * frac,
  });

  // km the battery lasts on this route (hills included): to the reserve, and to empty
  const kwhPerKm = remaining > 0.5 ? est.needKwh / remaining : consumption / 100;
  const kwhNow = (trip.batteryCapacity * snap.battery) / 100;
  const kwhReserve = (trip.batteryCapacity * snap.reservePercent) / 100;
  const toEmptyKm = kwhPerKm > 0 ? kwhNow / kwhPerKm : Infinity;
  const toReserveKm = kwhPerKm > 0 ? Math.max(0, kwhNow - kwhReserve) / kwhPerKm : Infinity;

  const fix = trip.lastFix;
  // the map does not need every metre: move the car on it about every 150 m
  const posKey = fix ? `${fix.lat.toFixed(3)},${fix.lon.toFixed(3)}` : '';
  const chargers = useRouteChargers(points, dest.computedAt, fix ? [fix.lat, fix.lon] : null, remaining);

  const data: DriveMapData = useMemo(() => {
    const pos: LatLon | null = fix ? [fix.lat, fix.lon] : null;
    const parts = splitRoute(points, pos, remaining, toReserveKm, toEmptyKm);
    const flip = (a: LatLon[]) => a.map((p) => [p[1], p[0]] as [number, number]);
    return {
      ok: flip(parts.ok),
      reserve: flip(parts.reserve),
      out: flip(parts.out),
      pos: pos ? [pos[1], pos[0]] : null,
      dest: [dest.lon, dest.lat],
      reserveLabel: snap.reservePercent > 0 ? `${snap.reservePercent}% reserve` : 'empty',
      chargers: chargers
        .map((c) => {
          const at = kmAlongRoute(points, pos, remaining, [c.lat, c.lon]);
          if (at == null) return null;
          const pct = snap.battery - ((at * kwhPerKm) / trip.batteryCapacity) * 100;
          if (pct < 0) return null;
          return { lon: c.lon, lat: c.lat, label: `${Math.round(c.powerKw ?? 0)} kW · ${Math.round(pct)}%` };
        })
        .filter((c): c is { lon: number; lat: number; label: string } => !!c)
        .slice(0, 6),
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    posKey,
    dest.computedAt,
    dest.lat,
    dest.lon,
    Math.round(toReserveKm),
    Math.round(toEmptyKm),
    Math.round(snap.battery),
    snap.reservePercent,
    chargers,
  ]);

  const color = ringColor(snap.usableBattery);
  const arrival = Math.max(0, Math.min(100, est.arrivalPct));
  const arrivalColor = est.status === 'ok' ? C.text : est.status === 'tight' ? C.amber : C.red;
  const kmPer10 = consumption > 0 ? ((trip.batteryCapacity * 0.1) / consumption) * 100 : 0;
  const shown = snap.recentConsumption ?? snap.consumption;

  return (
    <View>
      <View style={styles.map}>
        <DriveMap data={data} />
        <View style={styles.dial} pointerEvents="none">
          <MiniRing pct={snap.battery} color={color} />
          <Text style={styles.dialKm}>{Math.round(snap.rangeKm)}</Text>
          <Text style={styles.dialUnit}>km</Text>
        </View>
      </View>

      {/* battery now and on arrival */}
      <View style={styles.track}>
        <View style={[styles.fill, { width: `${Math.max(0, Math.min(100, snap.battery))}%`, backgroundColor: color }]} />
        {snap.reservePercent > 0 && (
          <View style={[styles.fill, { width: `${Math.min(snap.reservePercent, snap.battery)}%`, backgroundColor: C.amber }]} />
        )}
        {est.arrivalPct > 0 && <View style={[styles.mark, { left: `${arrival}%` }]} />}
      </View>
      <View style={styles.legend}>
        <Text style={[styles.legendValue, { color: arrivalColor }]}>
          {est.arrivalPct < 0 ? 'Not enough' : `${Math.round(est.arrivalPct)}%`}
          <Text style={styles.legendLabel}>{est.arrivalPct < 0 ? ' to arrive' : ' on arrival'}</Text>
        </Text>
        <Text style={styles.legendValue}>
          {Math.round(snap.battery)}%<Text style={styles.legendLabel}> now</Text>
        </Text>
      </View>

      <View style={styles.stats}>
        <View>
          <Text style={styles.statValue}>{shown.toFixed(1)}</Text>
          <Text style={styles.statLabel}>kWh/100 km</Text>
        </View>
        <View>
          <Text style={styles.statValue}>{kmPer10.toFixed(0)} km</Text>
          <Text style={styles.statLabel}>per 10% battery</Text>
        </View>
        <View>
          <Text style={styles.statValue}>{paused ? '–' : String(Math.round(snap.speedKmh))}</Text>
          <Text style={styles.statLabel}>km/h</Text>
        </View>
      </View>

      <TouchableOpacity
        style={styles.nav}
        activeOpacity={0.85}
        accessibilityRole="button"
        accessibilityLabel={`Navigate to ${dest.name}`}
        onPress={() => {
          tap();
          Linking.openURL(
            `https://www.google.com/maps/dir/?api=1&destination=${dest.lat},${dest.lon}&travelmode=driving`
          ).catch(() => {});
        }}
      >
        <Navigation size={18} color={C.onAccent} strokeWidth={2.4} />
        <Text style={styles.navText}>Navigate</Text>
      </TouchableOpacity>
    </View>
  );
}

function MiniRing({ pct, color }: { pct: number; color: string }) {
  const size = 92;
  const r = 40;
  const c = 2 * Math.PI * r;
  const dash = (c * Math.max(0, Math.min(100, pct))) / 100;
  return (
    <Svg width={size} height={size} style={StyleSheet.absoluteFill}>
      <Circle cx={size / 2} cy={size / 2} r={r} stroke={C.border} strokeWidth={6} fill="none" />
      <Circle
        cx={size / 2}
        cy={size / 2}
        r={r}
        stroke={color}
        strokeWidth={6}
        fill="none"
        strokeLinecap="round"
        strokeDasharray={`${dash} ${c}`}
        transform={`rotate(-90 ${size / 2} ${size / 2})`}
      />
    </Svg>
  );
}

/**
 * Fast chargers along the route, looked up once per calculated route: a search
 * every ~40 km along the line, kept when 50 kW or more and close to the road.
 */
function useRouteChargers(points: LatLon[], routeId: number, pos: LatLon | null, remainingKm: number): Charger[] {
  const [list, setList] = useState<Charger[]>([]);
  const done = useRef(0);
  useEffect(() => {
    if (points.length < 2 || done.current === routeId) return;
    done.current = routeId;
    let alive = true;
    (async () => {
      const ahead = splitRoute(points, pos, remainingKm, Infinity, Infinity).ok;
      if (ahead.length < 2) return;
      const n = Math.max(1, Math.min(5, Math.round(remainingKm / 40)));
      const stops: LatLon[] = [];
      for (let i = 1; i <= n; i++) stops.push(ahead[Math.min(ahead.length - 1, Math.round((i * (ahead.length - 1)) / (n + 1)))]);
      const found = new Map<string, Charger>();
      for (const s of stops) {
        try {
          const r = await fetchChargers({ lat: s[0], lon: s[1] }, 15, 40);
          if (r.sample) return; // no charger data set up
          for (const c of r.chargers) {
            if (c.dc && (c.powerKw ?? 0) >= 50 && c.operational !== false) found.set(c.id, c);
          }
        } catch {
          // skip this stretch
        }
      }
      if (!alive) return;
      const near = [...found.values()]
        .filter((c) => kmAlongRoute(points, pos, remainingKm, [c.lat, c.lon], 1.5) != null)
        .sort((a, b) => (b.powerKw ?? 0) - (a.powerKw ?? 0));
      // not on top of each other: one per ~20 km of route
      const picked: { c: Charger; at: number }[] = [];
      for (const c of near) {
        const at = kmAlongRoute(points, pos, remainingKm, [c.lat, c.lon], 1.5) ?? 0;
        if (picked.every((p) => Math.abs(p.at - at) > 20)) picked.push({ c, at });
        if (picked.length >= 6) break;
      }
      setList(picked.map((p) => p.c));
    })();
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [routeId, points.length]);
  return list;
}

const styles = StyleSheet.create({
  map: {
    height: MAP_HEIGHT,
    borderRadius: 20,
    overflow: 'hidden',
    backgroundColor: C.card,
    borderWidth: 1,
    borderColor: C.border,
  },
  dial: {
    position: 'absolute',
    left: 12,
    top: 12,
    width: 92,
    height: 92,
    borderRadius: 46,
    backgroundColor: C.bg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dialKm: { fontSize: 24, lineHeight: 26, fontFamily: F.display, color: C.text, letterSpacing: -0.6 },
  dialUnit: { fontSize: 12, lineHeight: 14, fontFamily: F.medium, color: C.textDim },
  track: { height: 14, borderRadius: 7, backgroundColor: C.border, overflow: 'hidden', marginTop: 16 },
  fill: { position: 'absolute', left: 0, top: 0, bottom: 0, borderRadius: 7 },
  mark: { position: 'absolute', top: 0, bottom: 0, width: 3, marginLeft: -1.5, backgroundColor: C.text },
  legend: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 8 },
  legendValue: { fontSize: 17, fontFamily: F.semibold, color: C.text },
  legendLabel: { fontSize: 13, fontFamily: F.medium, color: C.textDim },
  stats: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 16 },
  statValue: { fontSize: 22, lineHeight: 26, fontFamily: F.display, color: C.text, letterSpacing: -0.6 },
  statLabel: { fontSize: 13, fontFamily: F.medium, color: C.textDim },
  nav: {
    marginTop: 16,
    marginBottom: 14,
    height: 52,
    borderRadius: 16,
    backgroundColor: C.blue,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  navText: { fontSize: 16, fontFamily: F.semibold, color: C.onAccent },
});
