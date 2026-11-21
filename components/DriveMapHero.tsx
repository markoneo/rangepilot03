import { useEffect, useMemo, useRef, useState } from 'react';
import { Linking, Modal, Pressable, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import Svg, { Circle } from 'react-native-svg';
import { AlertTriangle, CheckCircle2, Navigation, Power, XCircle } from 'lucide-react-native';
import { C, F, batteryColor } from '@/constants/theme';
import { ArrivalCard } from '@/components/destination';
import { LiquidFill } from '@/components/LiquidFill';
import * as Trip from '@/utils/tripTracker';
import { DriveMap } from '@/components/DriveMap';
import { ringColor } from '@/utils/ringColor';
import { estimateArrival } from '@/utils/maps';
import { fetchChargers, type Charger } from '@/utils/chargers';
import { destinationRemainingKm, type TripState } from '@/utils/trackCore';
import { kmAlongRoute, splitRoute, type LatLon } from '@/utils/routeProgress';
import type { DriveMapData } from '@/utils/driveMapHtml';
import type { Snapshot } from '@/utils/tripTracker';
import { tap } from '@/components/ui';
import { useRouter } from 'expo-router';
import { navAvailable } from '@/components/DriveNav';
import { setNavChargers } from '@/utils/navShare';

const TILE = 88;
const RESERVE_OPTIONS = [10, 20, 0];

/**
 * The drive screen while a destination is set ("Map" view): everything on one
 * screen, no scrolling. The route on a map (green while the battery lasts,
 * amber on the reserve, dotted red beyond) with the range in a small dial;
 * under it the arrival result in one line, three small tiles (liquid battery,
 * consumption, km per 10 % + speed), the reserve choice with the OBD button,
 * and Navigate.
 */
export function DriveMapHero({
  trip,
  snap,
  paused,
  shownBattery,
  obdLive,
  charging,
  obdSupported,
  obdTone,
  onObd,
  onBattery,
  onConsumption,
  onChangeDestination,
}: {
  trip: TripState;
  snap: Snapshot;
  paused: boolean;
  /** battery % as shown (includes a correction still being typed) */
  shownBattery: number;
  obdLive: boolean;
  charging: boolean;
  obdSupported: boolean;
  obdTone: { fg: string; ring: string; label: string };
  onObd: () => void;
  onBattery: () => void;
  onConsumption: () => void;
  onChangeDestination: () => void;
}) {
  const router = useRouter();
  const [details, setDetails] = useState(false);
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

  useEffect(() => {
    setNavChargers(data.chargers.map((c) => ({ lat: c.lat, lon: c.lon, label: c.label })));
  }, [data]);

  const openMaps = () =>
    Linking.openURL(
      `https://www.google.com/maps/dir/?api=1&destination=${dest.lat},${dest.lon}&travelmode=driving`
    ).catch(() => {});

  const color = ringColor(snap.usableBattery);
  const st = est.status;
  const tone = st === 'ok' ? C.green : st === 'tight' ? C.amber : C.red;
  const toneBg = st === 'ok' ? C.greenDim : st === 'tight' ? C.amberDim : C.redDim;
  const Verdict = st === 'ok' ? CheckCircle2 : st === 'tight' ? AlertTriangle : XCircle;
  const headline = st === 'ok' ? 'You’ll make it' : st === 'tight' ? 'Tight — drive gently' : 'Charge on the way';
  const kmPer10 = consumption > 0 ? ((trip.batteryCapacity * 0.1) / consumption) * 100 : 0;
  const shown = obdLive && snap.recentConsumption != null ? snap.recentConsumption : snap.consumption;
  const consNote = obdLive
    ? snap.recentConsumption != null
      ? 'from car'
      : 'measuring…'
    : snap.learnConfidence === 'none'
      ? 'preset'
      : snap.learnConfidence === 'low'
        ? 'learning'
        : 'learned';
  const batt = Math.max(0, Math.min(100, shownBattery));
  const battColor = batteryColor(batt);
  // white with a soft dark edge: readable on the liquid and on the dark tile
  const battInk = { color: C.text, textShadowColor: 'rgba(6,19,12,0.55)', textShadowRadius: 6, textShadowOffset: { width: 0, height: 1 } };

  return (
    <View style={styles.root}>
      <View style={styles.map}>
        <DriveMap data={data} />
        <View style={styles.dial} pointerEvents="none">
          <MiniRing pct={snap.battery} color={color} />
          <Text style={styles.dialKm}>{Math.round(snap.rangeKm)}</Text>
          <Text style={styles.dialUnit}>km</Text>
        </View>
      </View>

      {/* arrival in one line; tap for the details, to change or clear the destination */}
      <TouchableOpacity
        style={[styles.arrival, { backgroundColor: toneBg }]}
        onPress={() => {
          tap();
          setDetails(true);
        }}
        activeOpacity={0.8}
        accessibilityRole="button"
        accessibilityLabel={`${headline}, arrive with ${Math.round(est.arrivalPct)} percent. Tap for details`}
      >
        <Verdict size={17} color={tone} />
        <Text style={[styles.arrivalText, { color: tone }]} numberOfLines={1}>
          {headline}
        </Text>
        <Text style={[styles.arrivalPct, { color: tone }]}>{Math.max(-99, Math.round(est.arrivalPct))}%</Text>
      </TouchableOpacity>

      <View style={styles.tiles}>
        <TouchableOpacity
          style={styles.battery}
          onPress={onBattery}
          disabled={obdLive}
          activeOpacity={0.8}
          accessibilityLabel={`Battery ${batt.toFixed(0)} percent${obdLive ? ', live from your car' : ', tap to set'}`}
        >
          <LiquidFill pct={batt} color={battColor} width={TILE} height={TILE} moving={!paused} charging={charging} />
          <Text style={[styles.batteryValue, battInk]}>{batt.toFixed(0)}</Text>
          <Text style={[styles.batteryPct, battInk]}>%</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={styles.tile}
          onPress={onConsumption}
          activeOpacity={0.8}
          accessibilityLabel="Consumption, tap to change"
        >
          <Text style={styles.tileValue} numberOfLines={1} adjustsFontSizeToFit>
            {shown.toFixed(1)}
          </Text>
          <Text style={styles.tileLabel}>kWh/100 km</Text>
          <Text style={[styles.tileNote, obdLive && snap.recentConsumption != null && { color: C.green }]}>{consNote}</Text>
        </TouchableOpacity>
        <View style={styles.tile}>
          <Text style={styles.tileValue} numberOfLines={1} adjustsFontSizeToFit>
            {kmPer10.toFixed(0)} km
          </Text>
          <Text style={styles.tileLabel}>per 10%</Text>
          <Text style={styles.tileNote}>
            <Text style={{ color: C.text }}>{paused ? '–' : String(Math.round(snap.speedKmh))}</Text> km/h
          </Text>
        </View>
      </View>

      <View style={styles.controls}>
        <View style={styles.seg} accessibilityRole="radiogroup">
          {RESERVE_OPTIONS.map((v) => {
            const on = snap.reservePercent === v;
            return (
              <TouchableOpacity
                key={v}
                style={[styles.segBtn, on && styles.segBtnOn]}
                onPress={() => {
                  tap();
                  Trip.setReserve(v);
                }}
                activeOpacity={0.8}
                accessibilityRole="radio"
                accessibilityState={{ selected: on }}
                accessibilityLabel={v === 0 ? 'No reserve' : `Reserve ${v} percent`}
              >
                <Text style={[styles.segText, on && styles.segTextOn]}>{v === 0 ? 'Off' : `${v}%`}</Text>
              </TouchableOpacity>
            );
          })}
        </View>
        {obdSupported && (
          <TouchableOpacity
            style={[styles.power, { borderColor: obdTone.ring }]}
            onPress={onObd}
            activeOpacity={0.8}
            accessibilityRole="switch"
            accessibilityLabel={`OBD connection, ${obdTone.label}`}
          >
            <Power size={20} color={obdTone.fg} strokeWidth={2.4} />
          </TouchableOpacity>
        )}
      </View>

      <View style={styles.navRow}>
        <TouchableOpacity
          style={styles.nav}
          activeOpacity={0.85}
          accessibilityRole="button"
          accessibilityLabel={`Navigate to ${dest.name}`}
          onPress={() => {
            tap();
            if (navAvailable) router.push('/navigate' as never);
            else openMaps();
          }}
        >
          <Navigation size={18} color={C.onAccent} strokeWidth={2.4} />
          <Text style={styles.navText}>Navigate</Text>
        </TouchableOpacity>
        {navAvailable && (
          <TouchableOpacity
            style={styles.navAlt}
            activeOpacity={0.85}
            accessibilityRole="button"
            accessibilityLabel="Open in Google Maps"
            onPress={() => {
              tap();
              openMaps();
            }}
          >
            <Text style={styles.navAltText}>Google Maps</Text>
          </TouchableOpacity>
        )}
      </View>

      {/* the full arrival card: route, energy, change or clear the destination */}
      <Modal visible={details} transparent animationType="fade" onRequestClose={() => setDetails(false)}>
        <Pressable style={styles.overlay} onPress={() => setDetails(false)}>
          <Pressable onPress={(e) => e.stopPropagation()}>
            <ArrivalCard
              place={dest}
              km={remaining}
              minutes={dest.minutes * frac}
              estimate={est}
              reservePct={snap.reservePercent}
              onChange={() => {
                setDetails(false);
                onChangeDestination();
              }}
              onClear={() => {
                setDetails(false);
                Trip.setDestination(null);
              }}
            />
          </Pressable>
        </Pressable>
      </Modal>
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
  root: { flex: 1, gap: 10 },
  map: {
    flex: 1,
    minHeight: 150,
    borderRadius: 20,
    overflow: 'hidden',
    backgroundColor: C.card,
    borderWidth: 1,
    borderColor: C.border,
  },
  dial: {
    position: 'absolute',
    left: 10,
    top: 10,
    width: 92,
    height: 92,
    borderRadius: 46,
    backgroundColor: C.bg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dialKm: { fontSize: 24, lineHeight: 26, fontFamily: F.display, color: C.text, letterSpacing: -0.6 },
  dialUnit: { fontSize: 12, lineHeight: 14, fontFamily: F.medium, color: C.textDim },
  arrival: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    borderRadius: 14,
    paddingHorizontal: 14,
    height: 44,
  },
  arrivalText: { flex: 1, fontSize: 15, fontFamily: F.semibold },
  arrivalPct: { fontSize: 20, fontFamily: F.display, letterSpacing: -0.4 },
  tiles: { flexDirection: 'row', gap: 10, height: TILE },
  battery: {
    width: TILE,
    height: TILE,
    borderRadius: 16,
    overflow: 'hidden',
    backgroundColor: C.cardHi,
    alignItems: 'center',
    justifyContent: 'center',
  },
  batteryValue: { fontSize: 30, lineHeight: 32, fontFamily: F.display, letterSpacing: -0.8 },
  batteryPct: { fontSize: 13, lineHeight: 15, fontFamily: F.semibold },
  tile: {
    flex: 1,
    borderRadius: 16,
    backgroundColor: C.card,
    borderWidth: 1,
    borderColor: C.border,
    paddingHorizontal: 12,
    justifyContent: 'center',
  },
  tileValue: { fontSize: 22, lineHeight: 26, fontFamily: F.display, color: C.text, letterSpacing: -0.6 },
  tileLabel: { fontSize: 12, fontFamily: F.medium, color: C.textDim },
  tileNote: { fontSize: 12, fontFamily: F.medium, color: C.textMute, marginTop: 4 },
  controls: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  seg: {
    flex: 1,
    flexDirection: 'row',
    backgroundColor: C.card,
    borderWidth: 1,
    borderColor: C.border,
    borderRadius: 14,
    padding: 4,
  },
  segBtn: { flex: 1, height: 38, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  segBtnOn: { backgroundColor: C.blue },
  segText: { fontSize: 15, fontFamily: F.semibold, color: C.text },
  segTextOn: { color: C.onAccent },
  power: {
    width: 46,
    height: 46,
    borderRadius: 23,
    borderWidth: 3,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: C.bg,
  },
  navRow: { flexDirection: 'row', gap: 10 },
  navAlt: {
    height: 50,
    paddingHorizontal: 16,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: C.borderHi,
    backgroundColor: C.card,
    alignItems: 'center',
    justifyContent: 'center',
  },
  navAltText: { fontSize: 14, fontFamily: F.semibold, color: C.text },
  nav: {
    flex: 1,
    height: 50,
    borderRadius: 16,
    backgroundColor: C.blue,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  navText: { fontSize: 16, fontFamily: F.semibold, color: C.onAccent },
  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'center', padding: 18 },
});
