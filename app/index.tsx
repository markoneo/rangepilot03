import { useState, useEffect, useCallback, useMemo } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Platform, ScrollView } from 'react-native';
import { useRouter, useFocusEffect } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Slider from '@react-native-community/slider';
import {
  loadCarSettings,
  loadAppState,
  saveAppState,
  loadTrips,
  loadPrefs,
  tripEnergyKwh,
  tripConsumption,
  CarSettings,
  AppState,
  TripRecord,
  UserPrefs,
  DEFAULT_PREFS,
} from '@/utils/storage';
import { rangeFor } from '@/utils/trackCore';
import * as Trip from '@/utils/tripTracker';
import { Zap, Navigation, Clock, ChartLine as LineChart, ChevronRight, Radio } from 'lucide-react-native';
import ProfileMenu from '@/components/ProfileMenu';
import { C, F, batteryColor, fmtMoney } from '@/constants/theme';
import { Card, Chips, Label, NumberSheet, Stepper } from '@/components/ui';
import { ArrivalCard, DestinationSheet } from '@/components/destination';
import { computeRoute, routeElevation, estimateArrival, type Place, type RouteInfo, type Elevation } from '@/utils/maps';
import { getCurrentPosition } from '@/utils/geolocation';
import { writeJSON } from '@/utils/kv';
import { Search, Snowflake } from 'lucide-react-native';
import { getOutsideTempC, COLD_LIMIT_C } from '@/utils/weather';
import { buildProfile, suggest, seasonOf, type Style } from '@/utils/learnedProfile';

if (Platform.OS === 'web' && typeof document !== 'undefined') {
  const STYLE_ID = 'rp-battery-slider-style';
  if (!document.getElementById(STYLE_ID)) {
    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = `
      .rp-battery-slider { -webkit-appearance: none; appearance: none; background: transparent; }
      .rp-battery-slider:focus { outline: none; }
      .rp-battery-slider::-webkit-slider-runnable-track { height: 12px; border-radius: 6px; background: #1F2937; }
      .rp-battery-slider::-moz-range-track { height: 12px; border-radius: 6px; background: #1F2937; }
      .rp-battery-slider::-webkit-slider-thumb {
        -webkit-appearance: none; appearance: none; width: 40px; height: 40px; border-radius: 20px;
        background: #F3F6FA; border: 3px solid #3B82F6; margin-top: -14px; cursor: grab;
        box-shadow: 0 4px 12px rgba(0,0,0,0.5);
      }
      .rp-battery-slider::-moz-range-thumb {
        width: 40px; height: 40px; border-radius: 20px; background: #F3F6FA; border: 3px solid #3B82F6;
        cursor: grab; box-shadow: 0 4px 12px rgba(0,0,0,0.5);
      }
    `;
    document.head.appendChild(style);
  }
}

const PRESETS: { key: AppState['preset']; label: string; value: number }[] = [
  { key: 'city', label: 'City', value: 15.5 },
  { key: 'mixed', label: 'Mixed', value: 18 },
  { key: 'highway', label: 'Highway', value: 21 },
];

const clampCons = (v: number) => Math.max(5, Math.min(50, Math.round(v * 10) / 10));

export default function HomeScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();

  const [car, setCar] = useState<CarSettings | null>(null);
  const [consumption, setConsumption] = useState(18);
  const [battery, setBattery] = useState(80);
  const [preset, setPreset] = useState<AppState['preset']>('mixed');
  const [loaded, setLoaded] = useState(false);
  const [trips, setTrips] = useState<TripRecord[]>([]);
  const [prefs, setPrefs] = useState<UserPrefs>(DEFAULT_PREFS);
  const [consSheet, setConsSheet] = useState(false);
  const [battSheet, setBattSheet] = useState(false);
  const [active, setActive] = useState(() => Trip.getSnapshot());
  const [destSheet, setDestSheet] = useState(false);
  const [here, setHere] = useState<{ lat: number; lon: number } | null>(null);
  const [check, setCheck] = useState<{
    place: Place;
    route: RouteInfo | null;
    elev: Elevation | null;
    loading: boolean;
    error?: string;
  } | null>(null);

  const [tempC, setTempC] = useState<number | null>(null);
  useEffect(() => {
    getCurrentPosition()
      .then((p) => (p ? getOutsideTempC(p.lat, p.lon) : null))
      .then((t) => t != null && setTempC(t))
      .catch(() => {});
  }, []);

  const openDest = () => {
    setDestSheet(true);
    getCurrentPosition().then((p) => p && setHere(p));
  };

  const checkPlace = async (p: Place) => {
    setCheck({ place: p, route: null, elev: null, loading: true });
    const from = here ?? (await getCurrentPosition());
    if (!from) {
      setCheck({ place: p, route: null, elev: null, loading: false, error: 'Allow location to calculate the route from where you are.' });
      return;
    }
    const route = await computeRoute(from, { lat: p.lat, lon: p.lon });
    if (!route) {
      setCheck({ place: p, route: null, elev: null, loading: false, error: 'Could not calculate a route.' });
      return;
    }
    const elev = await routeElevation(route.points);
    setCheck({ place: p, route, elev, loading: false });
  };

  useFocusEffect(
    useCallback(() => {
      let alive = true;
      (async () => {
        const settings = await loadCarSettings();
        if (!settings) {
          router.replace('/settings');
          return;
        }
        if (!alive) return;
        setCar(settings);
        const state = await loadAppState();
        if (state) {
          setConsumption(state.consumption);
          setBattery(state.batteryPercentage);
          setPreset(state.preset);
        }
        setPrefs(await loadPrefs());
        await Trip.loadActiveTrip();
        setActive(Trip.getSnapshot());
        setLoaded(true);
        loadTrips()
          .then((t) => alive && setTrips(t))
          .catch(() => {});
      })();
      const unsub = Trip.subscribe(() => setActive(Trip.getSnapshot()));
      const id = setInterval(() => setActive(Trip.getSnapshot()), 2000);
      return () => {
        alive = false;
        unsub();
        clearInterval(id);
      };
    }, [])
  );

  useEffect(() => {
    if (!loaded) return;
    saveAppState({ consumption, batteryPercentage: battery, preset });
  }, [consumption, battery, preset, loaded]);

  // "My average" from the last 10 trips with real (battery-based) consumption.
  const myAvg = useMemo(() => {
    const recent = trips.filter((t) => t.realConsumption != null && t.distanceKm >= 2).slice(0, 10);
    if (recent.length < 2) return null;
    const km = recent.reduce((s, t) => s + t.distanceKm, 0);
    const kwh = recent.reduce((s, t) => s + (t.realConsumption! * t.distanceKm) / 100, 0);
    return km > 0 ? clampCons((kwh / km) * 100) : null;
  }, [trips]);

  // Learned consumption per driving style for today's temperature.
  const profile = useMemo(() => buildProfile(trips), [trips]);

  // Keep the selected City / Mixed / Highway preset in sync with what has
  // been learned for today's weather.
  useEffect(() => {
    if (!loaded || (preset !== 'city' && preset !== 'mixed' && preset !== 'highway')) return;
    const s = suggest(profile, preset as Style, tempC);
    if (s && Math.abs(s.value - consumption) >= 0.1) setConsumption(s.value);
  }, [profile, tempC, preset, loaded]);

  const week = useMemo(() => {
    const since = Date.now() - 7 * 86400000;
    const w = trips.filter((t) => new Date(t.startedAt).getTime() >= since);
    const km = w.reduce((s, t) => s + t.distanceKm, 0);
    const kwh = w.reduce((s, t) => s + tripEnergyKwh(t), 0);
    const consKm = w.reduce((s, t) => s + tripConsumption(t) * t.distanceKm, 0);
    return { count: w.length, km, kwh, cons: km > 0 ? consKm / km : 0 };
  }, [trips]);

  if (!loaded || !car) return <View style={styles.root} />;

  const range = rangeFor(car.batteryCapacity, battery, consumption);
  const reserve = prefs.defaultReserve;
  const rangeReserve = rangeFor(car.batteryCapacity, battery, consumption, reserve);
  const usable = (car.batteryCapacity * battery) / 100;
  const bColor = batteryColor(battery);

  const presetValue = (p: (typeof PRESETS)[number]) => {
    const s = suggest(profile, p.key as Style, tempC);
    return s ? { value: s.value, learned: true } : { value: p.value, learned: false };
  };
  const anyLearned = PRESETS.some((p) => presetValue(p).learned);
  const season = seasonOf(tempC);

  const presetOptions = [
    ...PRESETS.map((p) => {
      const v = presetValue(p);
      return { label: p.label, value: p.key, sub: v.value.toFixed(1) + (v.learned ? ' ✨' : '') };
    }),
    ...(myAvg != null ? [{ label: 'My avg', value: 'avg' as const, sub: myAvg.toFixed(1) }] : []),
  ];

  const pickPreset = (k: AppState['preset']) => {
    setPreset(k);
    if (k === 'avg' && myAvg != null) setConsumption(myAvg);
    const p = PRESETS.find((x) => x.key === k);
    if (p) setConsumption(presetValue(p).value);
  };

  const changeCons = (v: number) => {
    setConsumption(clampCons(v));
    setPreset('custom');
  };

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      <ScrollView
        contentContainerStyle={[styles.scroll, { paddingBottom: insets.bottom + 28 }]}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.topBar}>
          <View style={{ flex: 1 }}>
            <View style={styles.brandRow}>
              <View style={styles.brandDot} />
              <Text style={styles.brandText}>RANGE PILOT</Text>
            </View>
            <Text style={styles.carName} numberOfLines={1}>
              {car.carName}
            </Text>
            <Text style={styles.carSub}>{car.batteryCapacity} kWh battery</Text>
          </View>
          <ProfileMenu size={48} />
        </View>

        {active && (
          <TouchableOpacity style={styles.activeBanner} onPress={() => router.push('/drive')} activeOpacity={0.85}>
            <Radio size={18} color={C.green} />
            <View style={{ flex: 1 }}>
              <Text style={styles.activeTitle}>
                {active.phase === 'paused' ? 'Drive paused' : 'Drive in progress'}
              </Text>
              <Text style={styles.activeSub}>
                {active.distanceKm.toFixed(1)} km · {Math.round(active.rangeKm)} km range left
              </Text>
            </View>
            <Text style={styles.activeAction}>Open</Text>
            <ChevronRight size={18} color={C.green} />
          </TouchableOpacity>
        )}

        {/* Hero range */}
        <View style={styles.hero}>
          <View style={styles.heroTop}>
            <Zap size={14} color={C.blue} fill={C.blue} />
            <Text style={styles.heroLabel}>Estimated range</Text>
          </View>
          <Text style={styles.heroValue}>
            {Math.round(range)}
            <Text style={styles.heroUnit}> km</Text>
          </Text>
          <Text style={styles.heroSub}>
            {usable.toFixed(1)} kWh · {consumption.toFixed(1)} kWh/100 km
            {reserve > 0 ? `  ·  ${Math.round(rangeReserve)} km to ${reserve}%` : ''}
          </Text>
          <Text style={styles.heroPer10}>
            10% battery = {Math.round((car.batteryCapacity * 10) / consumption)} km
          </Text>
        </View>

        {tempC != null && tempC < COLD_LIMIT_C && (
          <View style={styles.cold}>
            <Snowflake size={18} color="#7DD3FC" />
            <View style={{ flex: 1 }}>
              <Text style={styles.coldTitle}>
                {Math.round(tempC)}°C outside — expect 20–30% higher consumption
              </Text>
              <Text style={styles.coldBody}>
                Realistic range today: about {Math.round(range / 1.3)}–{Math.round(range / 1.2)} km. Correct the
                battery % during the drive and the app learns today’s real consumption.
              </Text>
            </View>
          </View>
        )}

        {/* Can I make it? */}
        {check ? (
          check.error ? (
            <Card>
              <Text style={styles.checkErr}>{check.error}</Text>
              <TouchableOpacity onPress={() => setCheck(null)}>
                <Text style={styles.checkLink}>Close</Text>
              </TouchableOpacity>
            </Card>
          ) : (
            <ArrivalCard
              place={check.place}
              km={check.route?.km ?? null}
              minutes={check.route?.minutes ?? null}
              climbM={check.elev?.climbM ?? null}
              descentM={check.elev?.descentM ?? null}
              reservePct={reserve}
              loading={check.loading}
              estimate={
                check.route
                  ? estimateArrival({
                      capacityKwh: car.batteryCapacity,
                      batteryPct: battery,
                      consumption,
                      reservePct: reserve,
                      km: check.route.km,
                      netM: check.elev?.netM ?? 0,
                    })
                  : null
              }
              onChange={openDest}
              onClear={() => setCheck(null)}
              footer={
                !active && check.route ? (
                  <TouchableOpacity
                    style={styles.checkStart}
                    activeOpacity={0.85}
                    onPress={async () => {
                      await writeJSON('ev_pending_destination', check.place);
                      router.push('/drive-permission');
                    }}
                  >
                    <Navigation size={16} color="#fff" />
                    <Text style={styles.checkStartText}>Start drive to here</Text>
                  </TouchableOpacity>
                ) : null
              }
            />
          )
        ) : (
          <TouchableOpacity style={styles.checkBtn} onPress={openDest} activeOpacity={0.8}>
            <Search size={18} color={C.blue} />
            <Text style={styles.checkBtnText}>Can I make it? Check a destination</Text>
          </TouchableOpacity>
        )}

        {/* Battery */}
        <Card>
          <Label>Battery now</Label>
          <TouchableOpacity onPress={() => setBattSheet(true)} activeOpacity={0.7} style={styles.battValueWrap}>
            <Text style={[styles.battValue, { color: bColor }]}>
              {battery}
              <Text style={styles.battPct}>%</Text>
            </Text>
          </TouchableOpacity>
          {Platform.OS !== 'web' ? (
            <Slider
              style={styles.slider}
              minimumValue={1}
              maximumValue={100}
              step={1}
              value={battery}
              onValueChange={(v) => setBattery(Math.round(v))}
              minimumTrackTintColor={bColor}
              maximumTrackTintColor={C.border}
              thumbTintColor={C.text}
            />
          ) : (
            <input
              type="range"
              min={1}
              max={100}
              step={1}
              value={battery}
              onChange={(e) => setBattery(Number(e.target.value))}
              style={{ width: '100%', height: 48, cursor: 'pointer', touchAction: 'pan-x' } as any}
              className="rp-battery-slider"
            />
          )}
        </Card>

        {/* Consumption */}
        <Card>
          <Label>Consumption</Label>
          <Chips options={presetOptions} value={preset} onChange={pickPreset} />
          {anyLearned && (
            <Text style={styles.learnNote}>
              ✨ learned from your trips{season && tempC != null ? ` · ${season} weather (${Math.round(tempC)}°C)` : ''}
            </Text>
          )}
          <View style={{ height: 16 }} />
          <Stepper
            value={consumption.toFixed(1)}
            unit="kWh/100"
            onMinus={() => changeCons(consumption - 0.5)}
            onPlus={() => changeCons(consumption + 0.5)}
            onMinusLong={() => changeCons(consumption - 2)}
            onPlusLong={() => changeCons(consumption + 2)}
            onPressValue={() => setConsSheet(true)}
          />
        </Card>

        {!active && (
          <TouchableOpacity
            style={styles.startBtn}
            onPress={() => router.push('/drive-permission')}
            activeOpacity={0.85}
          >
            <Navigation size={20} color="#FFFFFF" strokeWidth={2.5} />
            <Text style={styles.startText}>Start drive</Text>
          </TouchableOpacity>
        )}

        {/* This week */}
        {week.count > 0 && (
          <TouchableOpacity style={styles.week} onPress={() => router.push('/analytics')} activeOpacity={0.85}>
            <Text style={styles.weekLabel}>Last 7 days</Text>
            <View style={styles.weekRow}>
              <WeekStat value={week.km.toFixed(0)} unit="km" />
              <WeekStat value={String(week.count)} unit={week.count === 1 ? 'trip' : 'trips'} />
              <WeekStat value={week.cons.toFixed(1)} unit="kWh/100" />
              {prefs.electricityPrice != null && (
                <WeekStat value={fmtMoney(week.kwh * prefs.electricityPrice, prefs.currency)} unit="cost" />
              )}
            </View>
          </TouchableOpacity>
        )}

        <View style={styles.links}>
          <TouchableOpacity style={styles.link} onPress={() => router.push('/trip-history')} activeOpacity={0.8}>
            <Clock size={16} color={C.blue} strokeWidth={2.2} />
            <Text style={styles.linkText}>Trips</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.link} onPress={() => router.push('/analytics')} activeOpacity={0.8}>
            <LineChart size={16} color={C.blue} strokeWidth={2.2} />
            <Text style={styles.linkText}>Statistics</Text>
          </TouchableOpacity>
        </View>
      </ScrollView>

      <DestinationSheet
        visible={destSheet}
        near={here}
        onClose={() => setDestSheet(false)}
        onPick={(p) => {
          setDestSheet(false);
          checkPlace(p);
        }}
      />
      <NumberSheet
        visible={consSheet}
        title="Consumption"
        initial={consumption}
        unit="kWh/100 km"
        min={5}
        max={50}
        onConfirm={(v) => {
          setConsSheet(false);
          changeCons(v);
        }}
        onClose={() => setConsSheet(false)}
      />
      <NumberSheet
        visible={battSheet}
        title="Battery now"
        initial={battery}
        unit="%"
        min={1}
        max={100}
        decimals={0}
        onConfirm={(v) => {
          setBattSheet(false);
          setBattery(Math.round(v));
        }}
        onClose={() => setBattSheet(false)}
      />
    </View>
  );
}

function WeekStat({ value, unit }: { value: string; unit: string }) {
  return (
    <View style={{ flex: 1, alignItems: 'center' }}>
      <Text style={styles.weekValue} numberOfLines={1} adjustsFontSizeToFit>
        {value}
      </Text>
      <Text style={styles.weekUnit}>{unit}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: C.bg },
  scroll: { paddingHorizontal: 16, paddingTop: 12 },
  topBar: { flexDirection: 'row', alignItems: 'center', marginBottom: 16, gap: 12 },
  brandRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 8 },
  brandDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: C.blue },
  brandText: { fontSize: 11, fontFamily: F.semibold, color: C.textDim, letterSpacing: 2 },
  carName: { fontSize: 24, fontFamily: F.bold, color: C.text, letterSpacing: -0.5 },
  carSub: { fontSize: 13, fontFamily: F.regular, color: C.textDim, marginTop: 2 },
  activeBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: C.greenDim,
    borderColor: C.green + '55',
    borderWidth: 1,
    borderRadius: 16,
    padding: 14,
    marginBottom: 12,
  },
  activeTitle: { fontSize: 15, fontFamily: F.semibold, color: C.text },
  activeSub: { fontSize: 12.5, fontFamily: F.medium, color: C.textDim, marginTop: 2 },
  activeAction: { fontSize: 14, fontFamily: F.bold, color: C.green },
  hero: {
    backgroundColor: C.blueDim,
    borderRadius: 24,
    padding: 22,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: C.blue + '40',
  },
  heroTop: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  heroLabel: {
    fontSize: 12,
    fontFamily: F.semibold,
    color: '#93C5FD',
    letterSpacing: 0.8,
    textTransform: 'uppercase',
  },
  heroValue: { fontSize: 80, fontFamily: F.bold, color: C.text, letterSpacing: -4, lineHeight: 88, marginTop: 4 },
  heroUnit: { fontSize: 28, color: C.blue, letterSpacing: -0.5 },
  heroSub: { fontSize: 13, fontFamily: F.medium, color: '#93C5FD', marginTop: 4 },
  heroPer10: { fontSize: 15, fontFamily: F.bold, color: C.text, marginTop: 8 },
  battValueWrap: { alignItems: 'center', marginTop: -4, marginBottom: 4 },
  battValue: { fontSize: 48, fontFamily: F.bold, letterSpacing: -2 },
  battPct: { fontSize: 22, color: C.textDim },
  slider: { width: '100%', height: 48 },
  cold: {
    flexDirection: 'row',
    gap: 10,
    alignItems: 'flex-start',
    backgroundColor: '#0C2233',
    borderColor: '#7DD3FC44',
    borderWidth: 1,
    borderRadius: 16,
    padding: 14,
    marginBottom: 12,
  },
  coldTitle: { color: C.text, fontFamily: F.semibold, fontSize: 14 },
  coldBody: { color: C.textDim, fontFamily: F.regular, fontSize: 12.5, lineHeight: 18, marginTop: 3 },
  learnNote: { fontSize: 11.5, fontFamily: F.medium, color: C.textMute, marginTop: 8 },
  checkBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    borderRadius: 16,
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: C.blue + '88',
    paddingVertical: 15,
    marginBottom: 12,
  },
  checkBtnText: { fontSize: 15, fontFamily: F.semibold, color: C.blue },
  checkErr: { color: C.text, fontFamily: F.medium, fontSize: 14 },
  checkLink: { color: C.blue, fontFamily: F.semibold, fontSize: 14, marginTop: 10 },
  checkStart: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: C.blue,
    borderRadius: 12,
    paddingVertical: 12,
    marginTop: 14,
  },
  checkStartText: { color: '#fff', fontFamily: F.semibold, fontSize: 15 },
  startBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    backgroundColor: C.blue,
    borderRadius: 18,
    paddingVertical: 19,
    marginTop: 4,
    marginBottom: 12,
  },
  startText: { fontSize: 17, fontFamily: F.semibold, color: '#FFFFFF' },
  week: {
    backgroundColor: C.card,
    borderRadius: 18,
    padding: 16,
    borderWidth: 1,
    borderColor: C.border,
    marginBottom: 12,
  },
  weekLabel: {
    fontSize: 12,
    fontFamily: F.semibold,
    color: C.textDim,
    letterSpacing: 0.8,
    textTransform: 'uppercase',
    marginBottom: 10,
  },
  weekRow: { flexDirection: 'row' },
  weekValue: { fontSize: 20, fontFamily: F.bold, color: C.text, letterSpacing: -0.5 },
  weekUnit: { fontSize: 11, fontFamily: F.medium, color: C.textMute, marginTop: 2 },
  links: { flexDirection: 'row', gap: 10 },
  link: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 15,
    backgroundColor: C.card,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: C.border,
  },
  linkText: { fontSize: 14, fontFamily: F.semibold, color: C.text },
});
