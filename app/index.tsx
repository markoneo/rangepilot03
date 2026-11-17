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
import { Navigation, Clock, ChartLine as LineChart, ChevronRight, Radio, Settings as SettingsIcon } from 'lucide-react-native';
import { C, F, batteryColor, fmtMoney } from '@/constants/theme';
import { Card, NumberSheet } from '@/components/ui';
import { ArrivalCard, DestinationSheet } from '@/components/destination';
import { computeRoute, routeElevation, estimateArrival, type Place, type RouteInfo, type Elevation } from '@/utils/maps';
import { getCurrentPosition } from '@/utils/geolocation';
import { writeJSON } from '@/utils/kv';
import { Search, Snowflake, Zap as ZapIcon, Minus, Plus, X } from 'lucide-react-native';
import { loadCharges, averagePrice } from '@/utils/charges';
import { getOutsideTempC, COLD_LIMIT_C, coldNoteSeenToday, markColdNoteSeen } from '@/utils/weather';
import { ColdChip, COLD_BLUE } from '@/components/ColdChip';
import { buildProfile, suggest, seasonOf, type Style } from '@/utils/learnedProfile';
import { useObd } from '@/hooks/useObd';
import { ChargingBadge } from '@/components/ChargingBadge';
import { connectObd, disconnectObd, obdOwnPicker } from '@/utils/obd';
import { ObdPicker } from '@/components/ObdPicker';
import { Bluetooth } from 'lucide-react-native';

if (Platform.OS === 'web' && typeof document !== 'undefined') {
  const STYLE_ID = 'rp-battery-slider-style-v2';
  if (!document.getElementById(STYLE_ID)) {
    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = `
      .rp-battery-slider { -webkit-appearance: none; appearance: none; background: transparent; }
      .rp-battery-slider:focus { outline: none; }
      .rp-battery-slider::-webkit-slider-runnable-track { height: 12px; border-radius: 6px; background: var(--rp-fill, #1B2229); }
      .rp-battery-slider::-moz-range-track { height: 12px; border-radius: 6px; background: var(--rp-fill, #1B2229); }
      .rp-battery-slider::-webkit-slider-thumb {
        -webkit-appearance: none; appearance: none; width: 30px; height: 30px; border-radius: 15px;
        background: #FFFFFF; border: 0; margin-top: -9px; cursor: grab;
        box-shadow: 0 4px 12px rgba(0,0,0,0.5);
      }
      .rp-battery-slider::-moz-range-thumb {
        width: 30px; height: 30px; border-radius: 15px; background: #FFFFFF; border: 0;
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

  // Live battery % from the car, for users with an OBD adapter
  const { obd, supported: obdSupported, enabled: obdEnabled, live: obdLive } = useObd();
  const [obdPicker, setObdPicker] = useState(false);
  useEffect(() => {
    if (obdLive && obd.soc != null) setBattery(obd.soc);
  }, [obdLive, obd.soc]);

  const [tempC, setTempC] = useState<number | null>(null);
  const cold = tempC != null && tempC < COLD_LIMIT_C;
  const [coldOpen, setColdOpen] = useState(false);
  // Cold-weather note pops up once a day; afterwards only the ❄ chip shows.
  useEffect(() => {
    if (!cold) return;
    coldNoteSeenToday().then((seen) => {
      if (!seen) setColdOpen(true);
    });
  }, [cold]);
  const [avgPrice, setAvgPrice] = useState<number | null>(null);
  useFocusEffect(
    useCallback(() => {
      loadCharges().then((c) => setAvgPrice(averagePrice(c))).catch(() => {});
    }, [])
  );
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
    let cost: number | null = null;
    for (const t of w) {
      const p = t.pricePerKwh ?? avgPrice ?? prefs.electricityPrice;
      if (p != null) cost = (cost ?? 0) + tripEnergyKwh(t) * p;
    }
    return { count: w.length, km, kwh, cons: km > 0 ? consKm / km : 0, cost };
  }, [trips, avgPrice, prefs]);

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
        contentContainerStyle={[styles.scroll, { paddingBottom: insets.bottom + (active ? 96 : 168) }]}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.topBar}>
          <View style={{ flex: 1 }}>
            <Text style={styles.carName} numberOfLines={1}>
              {car.carName}
            </Text>
            <Text style={styles.carSub}>{car.batteryCapacity} kWh battery</Text>
          </View>
          <TouchableOpacity
            style={styles.settingsBtn}
            onPress={() => router.push('/settings')}
            activeOpacity={0.8}
            accessibilityLabel="Settings"
          >
            <SettingsIcon size={22} color={C.textDim} />
          </TouchableOpacity>
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

        {/* Range + battery: one block */}
        <View style={styles.heroTop}>
          <Text style={styles.heroLabel}>Estimated range</Text>
          {cold && <ColdChip tempC={tempC!} onPress={() => setColdOpen((o) => !o)} />}
        </View>
        <View style={styles.heroRow}>
          <Text style={styles.heroValue}>
            {Math.round(range)}
            <Text style={styles.heroUnit}> km</Text>
          </Text>
          {obd.charging && (
            <View style={styles.heroCharge}>
              <ChargingBadge size={52} />
            </View>
          )}
        </View>

        {coldOpen && cold && (
          <View style={styles.cold}>
            <Snowflake size={16} color={COLD_BLUE} style={{ marginTop: 2 }} />
            <View style={{ flex: 1 }}>
              <Text style={styles.coldTitle}>
                {Math.round(tempC ?? 0)}°C outside — expect 20–30% higher consumption
              </Text>
              <Text style={styles.coldBody}>
                Realistic range today: about {Math.round(range / 1.3)}–{Math.round(range / 1.2)} km. Correct the
                battery % during the drive and the app learns today’s real consumption.
              </Text>
            </View>
            <TouchableOpacity
              onPress={() => {
                setColdOpen(false);
                markColdNoteSeen();
              }}
              hitSlop={12}
              accessibilityLabel="Dismiss"
            >
              <X size={16} color={C.textDim} />
            </TouchableOpacity>
          </View>
        )}

        {obdLive ? (
          <View style={styles.battRow}>
            <Text style={[styles.battValue, { color: bColor }]}>{battery.toFixed(1)}%</Text>
            <View style={styles.liveRow}>
              <View style={styles.liveDot} />
              <Text style={styles.battSub}>{usable.toFixed(1)} kWh · live from your car</Text>
            </View>
          </View>
        ) : (
          <>
            <View style={styles.battStep}>
              <TouchableOpacity
                style={styles.roundBtn}
                onPress={() => setBattery((b) => Math.max(1, Math.round(b) - 1))}
                onLongPress={() => setBattery((b) => Math.max(1, Math.round(b) - 5))}
                delayLongPress={350}
                activeOpacity={0.7}
                accessibilityLabel="Battery down"
              >
                <Minus size={20} color={C.text} strokeWidth={2.5} />
              </TouchableOpacity>
              <TouchableOpacity onPress={() => setBattSheet(true)} activeOpacity={0.7} style={{ alignItems: 'center' }}>
                <Text style={[styles.battValue, { color: bColor }]}>{Math.round(battery)}%</Text>
                <Text style={styles.battSub}>{usable.toFixed(1)} kWh · match your car</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.roundBtn}
                onPress={() => setBattery((b) => Math.min(100, Math.round(b) + 1))}
                onLongPress={() => setBattery((b) => Math.min(100, Math.round(b) + 5))}
                delayLongPress={350}
                activeOpacity={0.7}
                accessibilityLabel="Battery up"
              >
                <Plus size={20} color={C.text} strokeWidth={2.5} />
              </TouchableOpacity>
            </View>
          </>
        )}
        {obdLive ? (
          <View style={styles.liveTrack}>
            <View style={[styles.liveFill, { width: `${battery}%`, backgroundColor: bColor }]} />
          </View>
        ) : Platform.OS !== 'web' ? (
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
            style={
              {
                width: '100%',
                height: 40,
                cursor: 'pointer',
                touchAction: 'pan-x',
                '--rp-fill': `linear-gradient(to right, ${bColor} ${battery}%, #1B2229 ${battery}%)`,
              } as any
            }
            className="rp-battery-slider"
          />
        )}

        <View style={styles.facts}>
          {reserve > 0 && (
            <Fact value={`${Math.round(rangeReserve)} km`} label={`to ${reserve}% reserve`} first />
          )}
          <Fact
            value={`${Math.round((car.batteryCapacity * 10) / consumption)} km`}
            label="per 10% battery"
            first={reserve <= 0}
          />
          {cold && (
            <Fact value={`${Math.round(range / 1.3)}–${Math.round(range / 1.2)}`} label="km in the cold" />
          )}
        </View>

        {/* Consumption */}
        <View style={styles.consHead}>
          <Text style={styles.sectionLabel}>Consumption</Text>
          <TouchableOpacity onPress={() => setConsSheet(true)} activeOpacity={0.7} hitSlop={10}>
            <Text style={styles.consValue}>
              {consumption.toFixed(1)}
              <Text style={styles.consUnit}> kWh/100 · tap to set</Text>
            </Text>
          </TouchableOpacity>
        </View>
        <View style={styles.seg}>
          {presetOptions.map((o) => {
            const on = o.value === preset;
            return (
              <TouchableOpacity
                key={o.value}
                style={[styles.segItem, on && styles.segItemOn]}
                onPress={() => pickPreset(o.value)}
                activeOpacity={0.8}
              >
                <Text style={[styles.segLabel, on && { color: C.text }]}>{o.label}</Text>
                <Text style={[styles.segValue, on && { color: C.green }]}>{o.sub}</Text>
              </TouchableOpacity>
            );
          })}
        </View>
        {anyLearned && (
          <Text style={styles.learnNote}>
            ✨ learned from your trips{season && tempC != null ? ` · ${season} weather (${Math.round(tempC)}°C)` : ''}
          </Text>
        )}

        {/* Can I make it? */}
        {check ? (
          <View style={{ marginTop: 14 }}>
            {check.error ? (
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
                      <Navigation size={16} color={C.onAccent} />
                      <Text style={styles.checkStartText}>Start drive to here</Text>
                    </TouchableOpacity>
                  ) : null
                }
              />
            )}
          </View>
        ) : null}

        <View style={[styles.list, check ? null : { marginTop: 14 }]}>
          {!check && (
            <TouchableOpacity style={styles.row} onPress={openDest} activeOpacity={0.8}>
              <View style={styles.rowIcon}>
                <Search size={17} color={C.green} strokeWidth={2.4} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.rowTitle}>Can I make it?</Text>
                <Text style={styles.rowSub}>Check a destination</Text>
              </View>
              <ChevronRight size={18} color={C.textMute} />
            </TouchableOpacity>
          )}
          <TouchableOpacity
            style={[styles.row, !check && styles.rowDivider]}
            onPress={() => router.push('/chargers' as any)}
            activeOpacity={0.8}
          >
            <View style={styles.rowIcon}>
              <ZapIcon size={17} color={C.green} fill={C.green} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.rowTitle}>Chargers nearby</Text>
              <Text style={styles.rowSub}>Which you can reach, and with how much battery</Text>
            </View>
            <ChevronRight size={18} color={C.textMute} />
          </TouchableOpacity>
          {obdSupported && (
            <TouchableOpacity
              style={[styles.row, styles.rowDivider]}
              onPress={() => {
                if (obd.status !== 'off' && obd.status !== 'unsupported-car') return;
                if (obdOwnPicker) setObdPicker(true);
                else connectObd();
              }}
              disabled={obd.status === 'connecting'}
              activeOpacity={0.8}
            >
              <View style={styles.rowIcon}>
                <Bluetooth size={17} color={C.green} strokeWidth={2.4} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.rowTitle}>OBD adapter</Text>
                <Text style={styles.rowSub}>
                  {obd.status === 'connected'
                    ? `${obd.name ?? 'Connected'} · live battery %. Unplug it if the car stands for days.`
                    : obd.status === 'connecting'
                      ? 'Connecting…'
                      : obd.status === 'lost'
                        ? 'Connection lost — reconnecting…'
                        : obd.error
                          ? obd.error
                          : obdEnabled
                            ? 'Not connected — tap to connect'
                            : 'Connect it for the real battery % from your car'}
                </Text>
              </View>
              {obd.status === 'connected' || obd.status === 'lost' ? (
                <TouchableOpacity onPress={disconnectObd} hitSlop={10}>
                  <Text style={styles.rowAction}>Disconnect</Text>
                </TouchableOpacity>
              ) : (
                <ChevronRight size={18} color={C.textMute} />
              )}
            </TouchableOpacity>
          )}
        </View>

        <ObdPicker visible={obdPicker} onClose={() => setObdPicker(false)} />

        {/* This week */}
        {week.count > 0 && (
          <TouchableOpacity style={styles.week} onPress={() => router.push('/analytics')} activeOpacity={0.85}>
            <Text style={styles.sectionLabel}>Last 7 days</Text>
            <View style={styles.weekRow}>
              <WeekStat value={week.km.toFixed(0)} unit="km" />
              <WeekStat value={String(week.count)} unit={week.count === 1 ? 'trip' : 'trips'} />
              <WeekStat value={week.cons.toFixed(1)} unit="kWh/100" />
              {week.cost != null && <WeekStat value={fmtMoney(week.cost, prefs.currency)} unit="cost" />}
            </View>
          </TouchableOpacity>
        )}
      </ScrollView>

      {/* Bottom: start + sections */}
      <View style={[styles.bottom, { paddingBottom: insets.bottom + 8 }]}>
        {!active && (
          <TouchableOpacity
            style={styles.startBtn}
            onPress={() => router.push('/drive-permission')}
            activeOpacity={0.85}
          >
            <Navigation size={20} color={C.onAccent} strokeWidth={2.5} />
            <Text style={styles.startText}>Start drive</Text>
          </TouchableOpacity>
        )}
        <View style={styles.tabs}>
          <TouchableOpacity style={styles.tab} onPress={() => router.push('/trip-history')} activeOpacity={0.7}>
            <Clock size={20} color={C.textDim} strokeWidth={2} />
            <Text style={styles.tabText}>Trips</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.tab} onPress={() => router.push('/charges' as any)} activeOpacity={0.7}>
            <ZapIcon size={20} color={C.textDim} strokeWidth={2} />
            <Text style={styles.tabText}>Charging</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.tab} onPress={() => router.push('/analytics')} activeOpacity={0.7}>
            <LineChart size={20} color={C.textDim} strokeWidth={2} />
            <Text style={styles.tabText}>Statistics</Text>
          </TouchableOpacity>
        </View>
      </View>

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

function Fact({ value, label, first }: { value: string; label: string; first?: boolean }) {
  return (
    <View style={[styles.fact, !first && styles.factDivider]}>
      <Text style={styles.factValue} numberOfLines={1} adjustsFontSizeToFit>
        {value}
      </Text>
      <Text style={styles.factLabel} numberOfLines={1}>
        {label}
      </Text>
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
  scroll: { paddingHorizontal: 22, paddingTop: 10 },
  topBar: { flexDirection: 'row', alignItems: 'center', marginBottom: 18, gap: 12 },
  carName: { fontSize: 22, fontFamily: F.displayBold, color: C.text, letterSpacing: -0.5 },
  carSub: { fontSize: 13, fontFamily: F.regular, color: C.textDim, marginTop: 1 },
  settingsBtn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: C.card,
  },
  activeBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: C.greenDim,
    borderRadius: 16,
    padding: 14,
    marginBottom: 16,
  },
  activeTitle: { fontSize: 15, fontFamily: F.semibold, color: C.text },
  activeSub: { fontSize: 12.5, fontFamily: F.medium, color: C.textDim, marginTop: 2 },
  activeAction: { fontSize: 14, fontFamily: F.bold, color: C.green },

  heroTop: { flexDirection: 'row', alignItems: 'center' },
  heroRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  heroCharge: { width: 110, alignItems: 'center' },
  heroLabel: { fontSize: 12, fontFamily: F.semibold, color: C.textDim, letterSpacing: 1, textTransform: 'uppercase' },
  sectionLabel: { fontSize: 12, fontFamily: F.semibold, color: C.textDim, letterSpacing: 1, textTransform: 'uppercase' },
  heroValue: { fontSize: 92, fontFamily: F.display, color: C.text, letterSpacing: -4.5, lineHeight: 92, marginTop: 6 },
  heroUnit: { fontSize: 26, fontFamily: F.displayBold, color: C.textDim, letterSpacing: -0.5 },
  cold: {
    flexDirection: 'row',
    gap: 10,
    alignItems: 'flex-start',
    backgroundColor: '#0F1A22',
    borderRadius: 14,
    padding: 12,
    marginTop: 12,
  },
  coldTitle: { color: C.text, fontFamily: F.semibold, fontSize: 13.5, lineHeight: 18 },
  coldBody: { color: C.textDim, fontFamily: F.regular, fontSize: 12.5, lineHeight: 18, marginTop: 3 },

  battRow: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', marginTop: 14 },
  battValue: { fontSize: 34, fontFamily: F.display, letterSpacing: -1.2 },
  battStep: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 12 },
  battSub: { fontSize: 12.5, fontFamily: F.medium, color: C.textDim },
  slider: { width: '100%', height: 40 },
  liveRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  liveDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: C.green },
  liveTrack: { height: 12, borderRadius: 6, backgroundColor: C.border, overflow: 'hidden', marginTop: 14, marginBottom: 14 },
  liveFill: { height: '100%', borderRadius: 6 },
  rowAction: { fontSize: 13, fontFamily: F.semibold, color: C.textDim },

  facts: {
    flexDirection: 'row',
    borderTopWidth: 1,
    borderBottomWidth: 1,
    borderColor: C.border,
    marginTop: 8,
  },
  fact: { flex: 1, paddingVertical: 12 },
  factDivider: { borderLeftWidth: 1, borderLeftColor: C.border, paddingLeft: 14 },
  factValue: { fontSize: 19, fontFamily: F.displayBold, color: C.text, letterSpacing: -0.5 },
  factLabel: { fontSize: 12, fontFamily: F.medium, color: C.textDim, marginTop: 1 },

  consHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 16 },
  consStep: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  roundBtn: {
    width: 46,
    height: 46,
    borderRadius: 23,
    backgroundColor: C.cardHi,
    alignItems: 'center',
    justifyContent: 'center',
  },
  consValue: { fontSize: 22, fontFamily: F.display, color: C.text, letterSpacing: -0.6 },
  consUnit: { fontSize: 12, fontFamily: F.medium, color: C.textDim, letterSpacing: 0 },
  seg: { flexDirection: 'row', gap: 4, backgroundColor: C.card, borderRadius: 16, padding: 4, marginTop: 10 },
  segItem: { flex: 1, alignItems: 'center', paddingVertical: 8, borderRadius: 12 },
  segItemOn: { backgroundColor: C.borderHi },
  segLabel: { fontSize: 13, fontFamily: F.semibold, color: C.textDim },
  segValue: { fontSize: 14, fontFamily: F.displayBold, color: C.text, marginTop: 1 },
  learnNote: { fontSize: 11.5, fontFamily: F.medium, color: C.textMute, marginTop: 8 },

  list: { backgroundColor: C.card, borderRadius: 20, marginBottom: 12 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 13, paddingHorizontal: 14 },
  rowDivider: { borderTopWidth: 1, borderTopColor: C.border },
  rowIcon: {
    width: 36,
    height: 36,
    borderRadius: 11,
    backgroundColor: C.greenDim,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rowTitle: { fontSize: 15, fontFamily: F.semibold, color: C.text },
  rowSub: { fontSize: 12.5, fontFamily: F.regular, color: C.textDim, marginTop: 1 },

  checkErr: { color: C.text, fontFamily: F.medium, fontSize: 14 },
  checkLink: { color: C.blue, fontFamily: F.semibold, fontSize: 14, marginTop: 10 },
  checkStart: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: C.blue,
    borderRadius: 14,
    paddingVertical: 13,
    marginTop: 14,
  },
  checkStartText: { color: C.onAccent, fontFamily: F.bold, fontSize: 15 },

  week: { backgroundColor: C.card, borderRadius: 20, padding: 16, marginBottom: 12 },
  weekRow: { flexDirection: 'row', marginTop: 10 },
  weekValue: { fontSize: 20, fontFamily: F.displayBold, color: C.text, letterSpacing: -0.5 },
  weekUnit: { fontSize: 11, fontFamily: F.medium, color: C.textMute, marginTop: 2 },

  bottom: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: C.bg,
    paddingHorizontal: 22,
    paddingTop: 10,
  },
  startBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    backgroundColor: C.blue,
    borderRadius: 18,
    height: 58,
  },
  startText: { fontSize: 17, fontFamily: F.bold, color: C.onAccent },
  tabs: { flexDirection: 'row', marginTop: 6 },
  tab: { flex: 1, alignItems: 'center', gap: 3, paddingVertical: 8 },
  tabText: { fontSize: 11, fontFamily: F.semibold, color: C.textDim },
});
