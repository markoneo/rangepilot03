import { useCallback, useEffect, useMemo, useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, FlatList, Linking, ActivityIndicator } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ArrowLeft, RefreshCw, Navigation, Zap, PlugZap, Info } from 'lucide-react-native';
import { C, F, batteryColor } from '@/constants/theme';
import { Chips } from '@/components/ui';
import { arrivalPct, fetchChargers, navigationUrl, type Charger, type Plug } from '@/utils/chargers';
import { getCurrentPosition } from '@/utils/geolocation';
import { loadAppState, loadCarSettings } from '@/utils/storage';
import * as Trip from '@/utils/tripTracker';
import { rangeFor } from '@/utils/trackCore';

type Filter = 'all' | 'dc' | 'CCS' | 'Type 2';

export default function ChargersScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [chargers, setChargers] = useState<Charger[]>([]);
  const [sample, setSample] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>('all');
  const [battery, setBattery] = useState(80);
  const [consumption, setConsumption] = useState(18);
  const [capacity, setCapacity] = useState(60);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    // Battery & consumption: the running drive if there is one, otherwise home screen values.
    const car = await loadCarSettings();
    if (car) setCapacity(car.batteryCapacity);
    const snap = Trip.getSnapshot();
    const trip = Trip.getTrip();
    if (snap && trip) {
      setBattery(snap.battery);
      setConsumption(snap.consumption);
    } else {
      const app = await loadAppState();
      if (app) {
        setBattery(app.batteryPercentage);
        setConsumption(app.consumption);
      }
    }
    const pos = trip?.lastFix ? { lat: trip.lastFix.lat, lon: trip.lastFix.lon } : await getCurrentPosition();
    if (!pos) {
      setError('Waiting for your location — allow location access and try again.');
      setLoading(false);
      return;
    }
    const res = await fetchChargers(pos);
    setChargers(res.chargers);
    setSample(res.sample);
    if (!res.sample && res.chargers.length === 0) setError('No chargers found nearby, or no connection.');
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const list = useMemo(
    () =>
      chargers.filter((c) =>
        filter === 'all' ? true : filter === 'dc' ? c.dc : c.plugs.includes(filter as Plug)
      ),
    [chargers, filter]
  );
  const range = rangeFor(capacity, battery, consumption, 0);

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <TouchableOpacity style={styles.hbtn} onPress={() => router.back()} activeOpacity={0.7}>
          <ArrowLeft size={22} color={C.textDim} />
        </TouchableOpacity>
        <Text style={styles.title}>Chargers nearby</Text>
        <TouchableOpacity style={styles.hbtn} onPress={load} activeOpacity={0.7} accessibilityLabel="Refresh">
          <RefreshCw size={19} color={C.textDim} />
        </TouchableOpacity>
      </View>

      <FlatList
        data={list}
        keyExtractor={(c) => c.id}
        contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: insets.bottom + 32 }}
        ListHeaderComponent={
          <>
            <View style={styles.rangeBar}>
              <View style={[styles.rangeDot, { backgroundColor: batteryColor(battery) }]} />
              <Text style={styles.rangeText}>
                <Text style={{ color: batteryColor(battery), fontFamily: F.bold }}>{Math.round(battery)}%</Text>
                {'  ·  '}
                <Text style={{ color: C.text, fontFamily: F.bold }}>{Math.round(range)} km</Text> range
                {'  ·  '}
                {consumption.toFixed(1)} kWh/100
              </Text>
            </View>
            <Chips
              options={[
                { label: 'All', value: 'all' as Filter },
                { label: 'Fast DC', value: 'dc' as Filter },
                { label: 'CCS', value: 'CCS' as Filter },
                { label: 'Type 2', value: 'Type 2' as Filter },
              ]}
              value={filter}
              onChange={setFilter}
            />
            {sample && (
              <View style={styles.note}>
                <Info size={15} color={C.amber} />
                <Text style={styles.noteText}>Preview with sample chargers — live data appears once the Open Charge Map key is added.</Text>
              </View>
            )}
            {loading && <ActivityIndicator color={C.blue} style={{ marginTop: 30 }} />}
            {!loading && error && <Text style={styles.error}>{error}</Text>}
            <View style={{ height: 6 }} />
          </>
        }
        ListFooterComponent={
          chargers.length > 0 ? (
            <Text style={styles.attrib} onPress={() => Linking.openURL('https://openchargemap.org')}>
              Charger data © Open Charge Map contributors (CC BY 4.0)
            </Text>
          ) : null
        }
        renderItem={({ item }) => {
          const arr = arrivalPct(item, battery, capacity, consumption);
          const reachable = arr >= 0;
          return (
            <View style={styles.card}>
              <View style={styles.row}>
                <View style={[styles.badge, { backgroundColor: item.dc ? C.blueDim : C.greenDim, borderColor: (item.dc ? C.blue : C.green) + '55' }]}>
                  {item.dc ? <Zap size={13} color={C.blue} fill={C.blue} /> : <PlugZap size={13} color={C.green} />}
                  <Text style={[styles.badgeKw, { color: item.dc ? C.blue : C.green }]}>
                    {item.powerKw != null ? Math.round(item.powerKw) : '–'}
                  </Text>
                  <Text style={styles.badgeUnit}>kW</Text>
                </View>
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text style={styles.name} numberOfLines={1}>{item.name}</Text>
                  <Text style={styles.sub} numberOfLines={1}>
                    {item.distanceKm.toFixed(1)} km{item.operator ? ` · ${item.operator}` : ''}
                    {item.points ? ` · ${item.points} ${item.points === 1 ? 'point' : 'points'}` : ''}
                  </Text>
                  <View style={styles.plugs}>
                    {item.plugs.map((p) => (
                      <Text key={p} style={styles.plug}>{p}</Text>
                    ))}
                  </View>
                </View>
                <View style={styles.arrive}>
                  {reachable ? (
                    <>
                      <Text style={[styles.arrivePct, { color: batteryColor(arr) }]}>{Math.round(arr)}%</Text>
                      <Text style={styles.arriveLabel}>on arrival</Text>
                    </>
                  ) : (
                    <>
                      <Text style={[styles.arrivePct, { color: C.red, fontSize: 15 }]}>Too far</Text>
                      <Text style={styles.arriveLabel}>not reachable</Text>
                    </>
                  )}
                </View>
              </View>
              <TouchableOpacity
                style={styles.go}
                onPress={() => Linking.openURL(navigationUrl(item))}
                activeOpacity={0.8}
              >
                <Navigation size={15} color={C.blue} />
                <Text style={styles.goText}>Navigate</Text>
              </TouchableOpacity>
            </View>
          );
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: C.bg },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 8, paddingVertical: 6 },
  hbtn: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  title: { fontSize: 18, fontFamily: F.bold, color: C.text },
  rangeBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: C.card,
    borderWidth: 1,
    borderColor: C.border,
    borderRadius: 14,
    paddingVertical: 11,
    paddingHorizontal: 14,
    marginBottom: 12,
  },
  rangeDot: { width: 8, height: 8, borderRadius: 4 },
  rangeText: { fontSize: 13.5, fontFamily: F.medium, color: C.textDim },
  note: {
    flexDirection: 'row',
    gap: 8,
    alignItems: 'flex-start',
    backgroundColor: C.amberDim,
    borderColor: C.amber + '44',
    borderWidth: 1,
    borderRadius: 12,
    padding: 11,
    marginTop: 12,
  },
  noteText: { flex: 1, color: C.text, fontSize: 12.5, fontFamily: F.medium, lineHeight: 17 },
  error: { color: C.textDim, textAlign: 'center', marginTop: 30, fontFamily: F.medium },
  card: {
    backgroundColor: C.card,
    borderWidth: 1,
    borderColor: C.border,
    borderRadius: 18,
    padding: 14,
    marginTop: 10,
  },
  row: { flexDirection: 'row', gap: 12, alignItems: 'center' },
  badge: { width: 60, height: 64, borderRadius: 14, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  badgeKw: { fontSize: 19, fontFamily: F.bold, letterSpacing: -0.5, marginTop: 1 },
  badgeUnit: { fontSize: 10, fontFamily: F.semibold, color: C.textDim, marginTop: -2 },
  name: { fontSize: 15.5, fontFamily: F.semibold, color: C.text },
  sub: { fontSize: 12.5, fontFamily: F.regular, color: C.textDim, marginTop: 2 },
  plugs: { flexDirection: 'row', gap: 6, marginTop: 7, flexWrap: 'wrap' },
  plug: {
    fontSize: 11,
    fontFamily: F.semibold,
    color: C.textDim,
    backgroundColor: C.cardHi,
    borderRadius: 6,
    paddingHorizontal: 7,
    paddingVertical: 2,
    overflow: 'hidden',
  },
  arrive: { alignItems: 'flex-end', minWidth: 70 },
  arrivePct: { fontSize: 22, fontFamily: F.bold, letterSpacing: -0.5 },
  arriveLabel: { fontSize: 11, fontFamily: F.medium, color: C.textMute },
  go: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 7,
    marginTop: 12,
    paddingVertical: 10,
    borderRadius: 11,
    backgroundColor: C.blueDim,
  },
  attrib: { color: C.textMute, fontSize: 11.5, fontFamily: F.regular, textAlign: 'center', marginTop: 18 },
  goText: { color: C.blue, fontFamily: F.semibold, fontSize: 14 },
});
