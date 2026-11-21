import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useKeepAwake } from 'expo-keep-awake';
import * as Location from 'expo-location';
import { C, F, batteryColor } from '@/constants/theme';
import { DriveNav, navAvailable } from '@/components/DriveNav';
import * as Trip from '@/utils/tripTracker';
import { destinationRemainingKm } from '@/utils/trackCore';
import { estimateArrival } from '@/utils/maps';
import { ringColor } from '@/utils/ringColor';
import { getNavChargers } from '@/utils/navShare';

/**
 * Turn-by-turn navigation to the trip's destination (iOS, Mapbox), with the
 * car's numbers on top of the map: range, battery now, battery on arrival.
 */
export default function NavigateScreen() {
  useKeepAwake();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [snap, setSnap] = useState(() => Trip.getSnapshot());
  const [origin, setOrigin] = useState<{ lat: number; lon: number } | null>(() => {
    const f = Trip.getTrip()?.lastFix;
    return f ? { lat: f.lat, lon: f.lon } : null;
  });
  const [error, setError] = useState<string | null>(null);
  const [chargers] = useState(() => getNavChargers());
  const [started, setStarted] = useState(false);
  const startedRef = useRef(false);
  const [slow, setSlow] = useState(false);
  useEffect(() => {
    if (started) return;
    const t = setTimeout(() => setSlow(true), 15000);
    return () => clearTimeout(t);
  }, [started]);

  useEffect(() => {
    const update = () => setSnap(Trip.getSnapshot());
    const unsub = Trip.subscribe(update);
    const id = setInterval(update, 2000);
    return () => {
      unsub();
      clearInterval(id);
    };
  }, []);

  // no GPS fix from the drive yet: ask the phone once
  useEffect(() => {
    if (origin) return;
    let alive = true;
    Location.getCurrentPositionAsync({})
      .then((p) => alive && setOrigin({ lat: p.coords.latitude, lon: p.coords.longitude }))
      .catch(() => alive && setError('Could not get your location.'));
    return () => {
      alive = false;
    };
  }, [origin]);

  const close = () => (router.canGoBack() ? router.back() : router.replace('/drive'));
  const trip = Trip.getTrip();
  const dest = trip?.destination;

  if (!navAvailable || !trip || !dest || !snap || error) {
    return (
      <View style={[styles.center, { paddingTop: insets.top }]}>
        <Text style={styles.msg}>
          {error ?? (!navAvailable ? 'Navigation is available on iPhone only.' : 'Set a destination first.')}
        </Text>
        <TouchableOpacity style={styles.back} onPress={close} accessibilityRole="button">
          <Text style={styles.backText}>Back</Text>
        </TouchableOpacity>
      </View>
    );
  }
  if (!origin) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={C.blue} />
      </View>
    );
  }

  const remaining = destinationRemainingKm(trip) ?? dest.routeKm;
  const frac = dest.routeKm > 0 ? remaining / dest.routeKm : 0;
  const est = estimateArrival({
    capacityKwh: trip.batteryCapacity,
    batteryPct: snap.battery,
    consumption: snap.obdLive ? snap.flatConsumption : snap.consumption,
    reservePct: snap.reservePercent,
    km: remaining,
    netM: dest.netM * frac,
  });
  const tone = est.status === 'ok' ? C.green : est.status === 'tight' ? C.amber : C.red;

  return (
    <View style={styles.root}>
      <DriveNav
        origin={origin}
        dest={dest}
        chargers={chargers}
        onClose={close}
        // once guidance runs, a failed re-route must not take the map away
        onError={(m) => !startedRef.current && setError(m)}
        onStarted={() => {
          startedRef.current = true;
          setStarted(true);
        }}
      />

      {!started && (
        <View style={styles.wait} pointerEvents="none">
          <ActivityIndicator color={C.blue} />
          <Text style={styles.msg}>{slow ? 'Still no route after 15 seconds.' : 'Finding the route…'}</Text>
          {slow && <Text style={styles.hint}>Close and send a screenshot of this screen.</Text>}
        </View>
      )}

      {/* the car's numbers, under the turn banner */}
      <View style={[styles.chip, { top: insets.top + 152 }]} pointerEvents="none">
        <View style={styles.cell}>
          <Text style={[styles.big, { color: ringColor(snap.usableBattery) }]}>{Math.round(snap.rangeKm)}</Text>
          <Text style={styles.unit}>km range</Text>
        </View>
        <View style={styles.sep} />
        <View style={styles.cell}>
          <Text style={[styles.big, { color: batteryColor(snap.battery) }]}>{Math.round(snap.battery)}%</Text>
          <Text style={styles.unit}>battery</Text>
        </View>
        <View style={styles.sep} />
        <View style={styles.cell}>
          <Text style={[styles.big, { color: tone }]}>{Math.max(-99, Math.round(est.arrivalPct))}%</Text>
          <Text style={styles.unit}>on arrival</Text>
        </View>
      </View>

    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: C.bg },
  center: { flex: 1, backgroundColor: C.bg, alignItems: 'center', justifyContent: 'center', padding: 24, gap: 16 },
  wait: { ...StyleSheet.absoluteFillObject, alignItems: 'center', justifyContent: 'center', gap: 12, padding: 24 },
  hint: { fontSize: 13, fontFamily: F.medium, color: C.text, opacity: 0.6, textAlign: 'center' },
  msg: { fontSize: 15, fontFamily: F.medium, color: C.text, textAlign: 'center' },
  back: { height: 46, paddingHorizontal: 22, borderRadius: 14, backgroundColor: C.blue, justifyContent: 'center' },
  backText: { fontSize: 15, fontFamily: F.semibold, color: C.onAccent },
  chip: {
    position: 'absolute',
    left: 12,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(11,14,17,0.92)',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: C.borderHi,
    paddingVertical: 8,
    paddingHorizontal: 6,
  },
  cell: { alignItems: 'center', paddingHorizontal: 10 },
  big: { fontSize: 19, fontFamily: F.bold },
  unit: { fontSize: 10, fontFamily: F.medium, color: C.text, opacity: 0.65, marginTop: 1 },
  sep: { width: 1, height: 26, backgroundColor: C.borderHi },
});
