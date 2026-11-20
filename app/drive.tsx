import { useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  Platform,
  AppState,
  Linking,
  Modal,
  Pressable,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { activateKeepAwakeAsync, deactivateKeepAwake } from 'expo-keep-awake';
import { keepScreenOn, allowScreenOff } from '@/utils/screenAwake';
import { ChevronDown, Pause, Play, Flag, Zap, MapPinOff, MapPin, X, Sparkles, Search, Snowflake, Power, Minus, Plus } from 'lucide-react-native';
import { COLD_LIMIT_C, coldNoteSeenToday, markColdNoteSeen } from '@/utils/weather';
import { ColdChip, COLD_BLUE } from '@/components/ColdChip';
import { ChargeSheet } from '@/components/ChargeSheet';
import { Popup } from '@/components/Popup';
import { loadCharges } from '@/utils/charges';
import { buildProfile, suggest, styleOf, seasonOf, STYLES, type Profile } from '@/utils/learnedProfile';
import { ArrivalCard, DestinationSheet } from '@/components/destination';
import { computeRoute, routeElevation, estimateArrival, type Place } from '@/utils/maps';
import { destinationRemainingKm, CHARGE_JUMP_PCT } from '@/utils/trackCore';
import { useObd } from '@/hooks/useObd';
import { connectObd, disconnectObd, obdOwnPicker } from '@/utils/obd';
import { ObdPicker } from '@/components/ObdPicker';
import { RangeRing } from '@/components/RangeRing';
import { LiquidFill } from '@/components/LiquidFill';
import { DriveMapHero } from '@/components/DriveMapHero';
import { simplifyRoute } from '@/utils/routeProgress';
import { ChargingBadge } from '@/components/ChargingBadge';
import { getCurrentPosition, watchForeground } from '@/utils/geolocation';
import { createMovingDetector } from '@/utils/movingDetector';
import { readJSON, kv } from '@/utils/kv';
import {
  getBackgroundPermissionStatus,
  getPermissionStatus,
  requestBackgroundPermission,
} from '@/utils/geolocation';
import { loadAppState, loadCarSettings, loadPrefs, loadTrips, formatDuration } from '@/utils/storage';
import * as Trip from '@/utils/tripTracker';
import type { Snapshot } from '@/utils/tripTracker';
import { C, F, batteryColor } from '@/constants/theme';
import { Card, Chips, Label, NumberSheet, Stepper, Toast, tap } from '@/components/ui';

const KEEP_AWAKE_TAG = 'range-pilot-drive';
const RESERVE_OPTIONS = [10, 20, 0];

function useTripSnapshot(): Snapshot | null {
  const [snap, setSnap] = useState<Snapshot | null>(() => Trip.getSnapshot());
  useEffect(() => {
    const update = () => setSnap(Trip.getSnapshot());
    const unsub = Trip.subscribe(update);
    const id = setInterval(update, 1000);
    return () => {
      unsub();
      clearInterval(id);
    };
  }, []);
  return snap;
}

export default function DriveScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const obdState = useObd();
  const params = useLocalSearchParams<{ start?: string }>();
  const snap = useTripSnapshot();
  const trip = Trip.getTrip();

  const [ready, setReady] = useState(false);
  const [toast, setToast] = useState<{ text: string; tone: 'green' | 'blue' | 'amber' } | null>(null);
  const [batterySheet, setBatterySheet] = useState(false);
  const [consSheet, setConsSheet] = useState(false);
  const [finishOpen, setFinishOpen] = useState(false);
  const [bgWarning, setBgWarning] = useState<'web' | 'native' | null>(null);
  const [destSheet, setDestSheet] = useState(false);
  // with a destination set: the map view, or back to the ring view
  const [view, setView] = useState<'map' | 'ring'>('map');
  const [obdPicker, setObdPicker] = useState(false);
  const [pendingBattery, setPendingBattery] = useState<number | null>(null);
  const pendingRef = useRef<number | null>(null);
  const pendingTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [coldOpen, setColdOpen] = useState(false);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [chargePrompt, setChargePrompt] = useState<{ from: number; to: number } | null>(null);
  const [chargeSheet, setChargeSheet] = useState(false);
  const [resumeAsk, setResumeAsk] = useState(false);
  const resumeSnoozeUntil = useRef(0);
  const [currency, setCurrency] = useState('€');
  useEffect(() => {
    loadPrefs().then((p) => setCurrency(p.currency)).catch(() => {});
  }, []);
  useEffect(() => {
    loadTrips()
      .then((t) => setProfile(buildProfile(t)))
      .catch(() => {});
  }, []);
  const [routing, setRouting] = useState(false);
  const routingRef = useRef(false);

  // Calculate (or refresh) the route from the current position to a place.
  const routeTo = async (p: Place, silent = false) => {
    if (routingRef.current) return;
    routingRef.current = true;
    if (!silent) setRouting(true);
    try {
      const t = Trip.getTrip();
      const from = t?.lastFix ? { lat: t.lastFix.lat, lon: t.lastFix.lon } : await getCurrentPosition();
      if (!from) {
        if (!silent) showToast('Waiting for GPS to calculate the route', 'amber');
        return;
      }
      const r = await computeRoute(from, { lat: p.lat, lon: p.lon });
      if (!r) {
        if (!silent) showToast('Could not calculate a route', 'amber');
        return;
      }
      const el = await routeElevation(r.points);
      await Trip.setDestination({
        name: p.name,
        address: p.address,
        lat: p.lat,
        lon: p.lon,
        routeKm: r.km,
        minutes: r.minutes,
        netM: el?.netM ?? 0,
        climbM: el?.climbM ?? 0,
        descentM: el?.descentM ?? 0,
        atDistanceKm: Trip.getTrip()?.distanceKm ?? 0,
        computedAt: Date.now(),
        points: simplifyRoute(r.points),
      });
    } finally {
      routingRef.current = false;
      setRouting(false);
    }
  };

  // A destination set from the car screen (or by an older version) has no route
  // line yet: fetch it once, for the map.
  const linedFor = useRef('');
  const destKey = trip?.destination ? `${trip.destination.lat},${trip.destination.lon}` : '';
  const destHasLine = (trip?.destination?.points?.length ?? 0) > 1;
  useEffect(() => {
    const d = Trip.getTrip()?.destination;
    if (!d || destHasLine || linedFor.current === destKey) return;
    linedFor.current = destKey;
    routeTo({ name: d.name, address: d.address, lat: d.lat, lon: d.lon }, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [destKey, destHasLine]);

  // Refresh the route every 10 minutes while driving (traffic / detours).
  useEffect(() => {
    const id = setInterval(() => {
      const t = Trip.getTrip();
      const d = t?.destination;
      if (!t || !d || t.phase !== 'driving' || !t.lastFix) return;
      if (Date.now() - d.computedAt > 10 * 60 * 1000 && (destinationRemainingKm(t) ?? 0) > 1) {
        routeTo({ name: d.name, address: d.address, lat: d.lat, lon: d.lon }, true);
      }
    }, 60 * 1000);
    return () => clearInterval(id);
  }, []);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastGaps = useRef<number | null>(null);

  const showToast = (text: string, tone: 'green' | 'blue' | 'amber' = 'green') => {
    setToast({ text, tone });
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 4500);
  };

  // Load the running trip, or start a new one when coming from "Start drive".
  useEffect(() => {
    (async () => {
      const existing = await Trip.resumeTrackingIfNeeded();
      if (!existing) {
        if (params.start !== '1') {
          router.replace('/');
          return;
        }
        const perm = await getPermissionStatus();
        if (perm !== 'granted' && Platform.OS !== 'web') {
          router.replace('/drive-permission');
          return;
        }
        const car = await loadCarSettings();
        if (!car) {
          router.replace('/settings');
          return;
        }
        const app = await loadAppState();
        const prefs = await loadPrefs();
        await Trip.startTrip({
          carName: car.carName,
          batteryCapacity: car.batteryCapacity,
          startBattery: app?.batteryPercentage ?? 80,
          consumption: app?.consumption ?? 18.5,
          reservePercent: prefs.defaultReserve,
          style:
            app?.preset === 'city' || app?.preset === 'mixed' || app?.preset === 'highway' ? app.preset : 'custom',
        });
        // Started with more battery than the last trip ended → probably charged.
        try {
          const startPct = app?.batteryPercentage ?? 80;
          const [last] = await loadTrips();
          if (last && startPct >= last.endBattery + CHARGE_JUMP_PCT) {
            const charges = await loadCharges();
            const logged = charges.some((c) => new Date(c.date).getTime() > new Date(last.endedAt).getTime());
            if (!logged) setChargePrompt({ from: Math.round(last.endBattery), to: Math.round(startPct) });
          }
        } catch {
          // ignore
        }
        const pending = await readJSON<Place>('ev_pending_destination');
        if (pending) {
          await kv.removeItem('ev_pending_destination');
          routeTo(pending);
        }
      }
      setReady(true);
      const bg = await getBackgroundPermissionStatus();
      if (bg === 'denied') {
        // App (Android/iPhone): explain first (Google Play prominent-disclosure
        // rule), then open the phone's "Allow all the time" screen. Shown once.
        const asked = await kv.getItem('ev_bg_permission_asked').catch(() => null);
        if (!asked) setBgWarning('native');
      } else if (bg === 'unsupported' && Platform.OS === 'web') {
        // Browser only — the installed app keeps tracking in the background.
        const hidden = await kv.getItem('ev_hide_web_bg_tip').catch(() => null);
        if (!hidden) setBgWarning('web');
      }
    })();
  }, []);

  // Keep the screen on while a drive exists.
  const hasTrip = !!snap;
  useEffect(() => {
    if (!hasTrip) return;
    if (Platform.OS === 'web') {
      keepScreenOn();
      return () => allowScreenOff();
    }
    const on = () => {
      activateKeepAwakeAsync(KEEP_AWAKE_TAG).catch(() => {});
    };
    on();
    const sub = AppState.addEventListener('change', (st) => {
      if (st === 'active') on();
    });
    return () => {
      sub.remove();
      try {
        deactivateKeepAwake(KEEP_AWAKE_TAG);
      } catch {
        // ignore
      }
    };
  }, [hasTrip]);

  // Cold-weather note pops up once a day; afterwards only the ❄ chip shows.
  const cold = snap?.outsideTempC != null && snap.outsideTempC < COLD_LIMIT_C;
  useEffect(() => {
    if (!cold) return;
    coldNoteSeenToday().then((seen) => {
      if (!seen) setColdOpen(true);
    });
  }, [cold]);

  // Paused but driving again? Watch GPS and ask to resume.
  const isPaused = snap?.phase === 'paused';
  useEffect(() => {
    if (!isPaused) {
      setResumeAsk(false);
      return;
    }
    const det = createMovingDetector();
    const w = watchForeground((c) => {
      if (Date.now() < resumeSnoozeUntil.current) {
        det.reset();
        return;
      }
      const moving = det.push({
        lat: c.latitude,
        lon: c.longitude,
        ts: c.timestamp,
        speedKmh: c.speed != null && c.speed >= 0 ? c.speed * 3.6 : null,
        accuracy: c.accuracy,
      });
      if (moving) {
        det.reset();
        setResumeAsk(true);
      }
    });
    return () => w.remove();
  }, [isPaused]);

  // Tell the user when a GPS gap was reconstructed.
  useEffect(() => {
    if (!snap || !trip) return;
    if (lastGaps.current == null) {
      lastGaps.current = snap.gpsGaps;
      return;
    }
    if (snap.gpsGaps > lastGaps.current) {
      lastGaps.current = snap.gpsGaps;
      const km = trip.lastGap?.committedKm ?? 0;
      // No pop-up while driving — the km are simply added.
      void km;
    }
  }, [snap?.gpsGaps]);

  if (!ready || !snap || !trip) {
    return (
      <View style={[styles.root, styles.center, { paddingTop: insets.top }]}>
        <Text style={styles.loading}>Starting drive…</Text>
      </View>
    );
  }

  const paused = snap.phase === 'paused';
  const obdLive = obdState.live;
  const obdEnabled = obdState.enabled;
  const obd = obdState.obd;
  const bColor = batteryColor(snap.battery);
  const kwhLeft = (trip.batteryCapacity * snap.usableBattery) / 100;
  // km per 10 % of battery at the current (or learned) consumption
  const kmPer10 = snap.consumption > 0 ? (trip.batteryCapacity * 0.1 * 100) / snap.consumption : 0;

  const gps = (() => {
    switch (snap.gps) {
      case 'active':
        return { label: 'GPS', fg: C.green, bg: C.greenDim };
      case 'weak':
        return { label: 'Weak GPS', fg: C.amber, bg: C.amberDim };
      case 'searching':
        return { label: 'Finding GPS…', fg: C.amber, bg: C.amberDim };
      case 'lost':
        return snap.provisionalKm > 0
          ? { label: `Tunnel mode · +${snap.provisionalKm.toFixed(1)} km`, fg: C.orange, bg: C.orangeDim }
          : { label: 'No GPS signal', fg: C.red, bg: C.redDim };
      default:
        return { label: 'Paused', fg: C.textDim, bg: C.cardHi };
    }
  })();

  const onBattery = async (v: number) => {
    setBatterySheet(false);
    setPendingBattery(null);
    if (v >= snap.battery + CHARGE_JUMP_PCT) setChargePrompt({ from: Math.round(snap.battery), to: Math.round(v) });
    // Learning happens quietly; the consumption box shows "learning / learned".
    await Trip.setBattery(v);
  };

  // ± taps are collected for a moment and applied once, so the learning
  // sees one clean correction instead of several in-between values.
  const stepBattery = (d: number) => {
    const base = pendingRef.current ?? snap.battery;
    const next = Math.max(0, Math.min(100, Math.round((base + d) * 10) / 10));
    pendingRef.current = next;
    setPendingBattery(next);
    if (pendingTimer.current) clearTimeout(pendingTimer.current);
    pendingTimer.current = setTimeout(() => {
      const v = pendingRef.current;
      pendingRef.current = null;
      if (v != null) onBattery(v);
    }, 1200);
  };
  const shownBattery = pendingBattery ?? snap.battery;

  // The round button switches the OBD connection on and off.
  const hasMap = !!trip.destination && (trip.destination.points?.length ?? 0) > 1;
  const mapMode = hasMap && view === 'map';
  const obdTone =
    obd.status === 'connected'
      ? { fg: C.green, ring: C.green, label: 'OBD on' }
      : obd.status === 'connecting'
        ? { fg: C.amber, ring: C.amber, label: 'Connecting…' }
        : obd.status === 'lost'
          ? { fg: C.amber, ring: C.amber, label: 'Reconnecting…' }
          : { fg: C.textDim, ring: C.borderHi, label: 'OBD off' };
  const onObdButton = () => {
    tap();
    if (obd.status === 'off' || obd.status === 'unsupported-car') {
      // an adapter used before reconnects by itself; otherwise choose one
      if (obdEnabled || !obdOwnPicker) connectObd();
      else setObdPicker(true);
    } else {
      disconnectObd();
    }
  };

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity
          onPress={() => (router.canGoBack() ? router.back() : router.replace('/'))}
          style={styles.headerBtn}
          activeOpacity={0.7}
          accessibilityLabel="Minimise drive"
        >
          <ChevronDown size={24} color={C.textDim} strokeWidth={2.2} />
        </TouchableOpacity>
        <View style={{ flex: 1 }}>
          <Text style={styles.headerTitle} numberOfLines={1}>
            {mapMode ? trip.destination!.name : trip.carName}
          </Text>
          <Text style={styles.headerSub} numberOfLines={1}>
            {mapMode ? destLine(trip) : paused ? 'Drive paused' : 'Drive in progress'}
          </Text>
        </View>
        {hasMap ? (
          <>
            {/* GPS state as a dot only: the switch needs the room */}
            <View style={[styles.gpsDot, { backgroundColor: gps.fg }]} accessibilityLabel={gps.label} />
            <View style={styles.viewSwitch} accessibilityRole="radiogroup">
              {(['map', 'ring'] as const).map((v) => {
                const on = (v === 'map') === mapMode;
                return (
                  <TouchableOpacity
                    key={v}
                    style={[styles.viewBtn, on && styles.viewBtnOn]}
                    onPress={() => {
                      tap();
                      setView(v);
                    }}
                    activeOpacity={0.8}
                    accessibilityRole="radio"
                    accessibilityState={{ selected: on }}
                    accessibilityLabel={v === 'map' ? 'Map view' : 'Ring view'}
                  >
                    <Text style={[styles.viewText, on && styles.viewTextOn]}>{v === 'map' ? 'Map' : 'Ring'}</Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          </>
        ) : (
          <View style={[styles.gpsPill, { backgroundColor: gps.bg }]}>
            <View style={[styles.gpsDot, { backgroundColor: gps.fg }]} />
            <Text style={[styles.gpsText, { color: gps.fg }]} numberOfLines={1}>
              {gps.label}
            </Text>
          </View>
        )}
      </View>

      <Toast text={toast?.text ?? null} tone={toast?.tone} />

      {mapMode ? (
        // With a destination: everything on one screen around the route map (no scrolling)
        <View style={[styles.mapBody, { paddingBottom: 92 + insets.bottom }]}>
          <DriveMapHero
            trip={trip}
            snap={snap}
            paused={paused}
            shownBattery={shownBattery}
            obdLive={obdLive}
            charging={obd.charging}
            obdSupported={obdState.supported}
            obdTone={obdTone}
            onObd={onObdButton}
            onBattery={() => setBatterySheet(true)}
            onConsumption={() => setConsSheet(true)}
            onChangeDestination={() => setDestSheet(true)}
          />
        </View>
      ) : (
      <ScrollView
        contentContainerStyle={[styles.scroll, { paddingBottom: 120 + insets.bottom }]}
        showsVerticalScrollIndicator={false}
      >

        {/* Range dial */}
        <View>
          <RangeRing
            km={snap.rangeKm}
            batteryPct={snap.battery}
            usablePct={snap.usableBattery}
            label="Range left"
            sub={snap.reservePercent > 0 ? `to ${snap.reservePercent}% reserve` : 'to empty'}
            moving={!paused}
          />
          {obd.charging && (
            <View style={styles.chargeSpot} pointerEvents="none">
              <ChargingBadge />
            </View>
          )}
          {/* speed and distance sit beside the dial */}
          <View style={[styles.flank, { left: -10 }]} pointerEvents="none">
            <Text style={[styles.flankValue, { color: paused ? C.text : speedColor(snap.speedKmh) }]}>
              {paused ? '–' : String(Math.round(snap.speedKmh))}
            </Text>
            <Text style={styles.flankLabel}>km/h</Text>
          </View>
          <View style={[styles.flank, { right: -10 }]} pointerEvents="none">
            <Text style={styles.flankValue}>
              {snap.distanceKm >= 100 ? snap.distanceKm.toFixed(0) : snap.distanceKm.toFixed(1)}
            </Text>
            <Text style={styles.flankLabel}>km driven</Text>
          </View>
          {cold && (
            <View style={styles.coldSpot}>
              <ColdChip tempC={snap.outsideTempC!} onPress={() => setColdOpen(true)} />
            </View>
          )}
        </View>

        {/* Reserve: range to 10 %, to 20 %, or to empty */}
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

        {/* Battery · OBD on/off · consumption */}
        <View style={styles.trio}>
          <TouchableOpacity
            style={styles.tile}
            onPress={() => setBatterySheet(true)}
            disabled={obdLive}
            activeOpacity={0.8}
            accessibilityLabel={`Battery ${shownBattery.toFixed(1)} percent${obdLive ? ', live from your car' : ', tap to set'}`}
          >
            <Text style={styles.tileTitle}>Battery</Text>
            <BatteryGauge pct={shownBattery} moving={!paused} charging={obd.charging} />
            {obdLive ? (
              <Text style={[styles.tileNote, { color: C.green }]} numberOfLines={1}>
                Live from car
              </Text>
            ) : (
              <View style={styles.pm}>
                <TouchableOpacity
                  style={styles.pmBtn}
                  onPress={() => stepBattery(-1)}
                  onLongPress={() => stepBattery(-5)}
                  activeOpacity={0.7}
                  accessibilityLabel="Battery minus one percent"
                >
                  <Minus size={18} color={C.text} strokeWidth={2.6} />
                </TouchableOpacity>
                <TouchableOpacity
                  style={styles.pmBtn}
                  onPress={() => stepBattery(1)}
                  onLongPress={() => stepBattery(5)}
                  activeOpacity={0.7}
                  accessibilityLabel="Battery plus one percent"
                >
                  <Plus size={18} color={C.text} strokeWidth={2.6} />
                </TouchableOpacity>
              </View>
            )}
          </TouchableOpacity>

          {obdState.supported && (
            <View style={styles.obdCol}>
              <TouchableOpacity
                style={[styles.power, { borderColor: obdTone.ring }]}
                onPress={onObdButton}
                activeOpacity={0.8}
                accessibilityRole="switch"
                accessibilityState={{ checked: obd.status === 'connected' }}
                accessibilityLabel="OBD connection"
              >
                <Power size={34} color={obdTone.fg} strokeWidth={2.4} />
              </TouchableOpacity>
              <Text style={[styles.obdLabel, { color: obdTone.fg }]} numberOfLines={2}>
                {obdTone.label}
              </Text>
            </View>
          )}

          <TouchableOpacity
            style={styles.tile}
            onPress={() => setConsSheet(true)}
            activeOpacity={0.8}
            accessibilityLabel="Consumption, tap to change"
          >
            <Text style={styles.tileTitle}>Consumption</Text>
            <View>
              <Text style={styles.consBig} numberOfLines={1} adjustsFontSizeToFit>
                {(obdLive && snap.recentConsumption != null ? snap.recentConsumption : snap.consumption).toFixed(1)}
              </Text>
              <Text style={styles.tileUnit}>kWh/100 km</Text>
            </View>
            <Text
              style={[styles.tileNote, { color: obdLive && snap.recentConsumption != null ? C.green : C.textDim }]}
              numberOfLines={1}
            >
              {obdLive
                ? snap.recentConsumption != null
                  ? 'from car'
                  : 'measuring…'
                : snap.learnConfidence === 'none'
                  ? 'preset'
                  : snap.learnConfidence === 'low'
                    ? 'learning'
                    : 'learned'}
            </Text>
          </TouchableOpacity>
        </View>
        {obd.error && obd.status !== 'connected' ? <Text style={styles.obdError}>{obd.error}</Text> : null}

        <View style={styles.perTen}>
          <Text style={styles.perTenValue}>{kmPer10.toFixed(0)} km</Text>
          <Text style={styles.perTenLabel}>per 10% battery</Text>
        </View>
        {snap.estimatedKm >= 0.1 && (
          <Text style={styles.estNote}>
            {snap.estimatedKm.toFixed(1)} km reconstructed across {snap.gpsGaps} GPS{' '}
            {snap.gpsGaps === 1 ? 'gap' : 'gaps'} (tunnels / background)
          </Text>
        )}

        {/* Can I make it? */}
        {trip.destination ? (
          (() => {
            const dest = trip.destination!;
            const remaining = destinationRemainingKm(trip) ?? dest.routeKm;
            const frac = dest.routeKm > 0 ? remaining / dest.routeKm : 0;
            const est = estimateArrival({
              capacityKwh: trip.batteryCapacity,
              batteryPct: snap.battery,
              // with OBD the live figure already contains the hills just driven; the route's
              // remaining climb is added by the estimate itself, so start from the level-road figure
              consumption: snap.obdLive ? snap.flatConsumption : snap.consumption,
              reservePct: snap.reservePercent,
              km: remaining,
              netM: dest.netM * frac,
            });
            return (
              <ArrivalCard
                place={dest}
                km={remaining}
                minutes={dest.minutes * frac}
                climbM={Math.round(dest.climbM * frac)}
                descentM={Math.round(dest.descentM * frac)}
                estimate={est}
                reservePct={snap.reservePercent}
                loading={routing}
                onChange={() => setDestSheet(true)}
                onClear={() => Trip.setDestination(null)}
              />
            );
          })()
        ) : routing ? (
          <View style={styles.destBtn}>
            <Text style={styles.destBtnText}>Calculating route…</Text>
          </View>
        ) : (
          <TouchableOpacity style={styles.destBtn} onPress={() => setDestSheet(true)} activeOpacity={0.8}>
            <Search size={18} color={C.blue} />
            <Text style={styles.destBtnText}>Can I make it? Add destination</Text>
          </TouchableOpacity>
        )}

      </ScrollView>
      )}

      {/* Bottom controls */}
      <View style={[styles.bottom, { paddingBottom: insets.bottom + 12 }]}>
        {paused ? (
          <TouchableOpacity
            style={[styles.ctrl, styles.resume]}
            onPress={() => {
              tap();
              Trip.resumeTrip();
            }}
            activeOpacity={0.85}
          >
            <Play size={20} color={C.onAccent} fill={C.onAccent} />
            <Text style={styles.ctrlTextLight}>Resume</Text>
          </TouchableOpacity>
        ) : (
          <TouchableOpacity
            style={[styles.ctrl, styles.pause]}
            onPress={() => {
              tap();
              Trip.pauseTrip();
            }}
            activeOpacity={0.85}
          >
            <Pause size={20} color={C.text} fill={C.text} />
            <Text style={styles.ctrlText}>Pause</Text>
          </TouchableOpacity>
        )}
        <TouchableOpacity
          style={[styles.ctrl, styles.finish]}
          onPress={() => setFinishOpen(true)}
          activeOpacity={0.85}
        >
          <Flag size={20} color={C.red} />
          <Text style={[styles.ctrlText, { color: C.red }]}>Finish</Text>
        </TouchableOpacity>
      </View>

      <Popup
        visible={coldOpen && cold && !bgWarning}
        tone={COLD_BLUE}
        icon={<Snowflake size={26} color={COLD_BLUE} />}
        title={`${Math.round(snap.outsideTempC ?? 0)}°C outside — expect 20–30% higher consumption`}
        body={
          snap.learnConfidence === 'medium' || snap.learnConfidence === 'high'
            ? 'Your learned consumption already includes today’s conditions.'
            : `Range could be closer to ${Math.round(snap.rangeKm / 1.3)}–${Math.round(snap.rangeKm / 1.2)} km. Correct the battery % after ~20 km and the app adapts.`
        }
        primary={{
          label: 'OK',
          onPress: () => {
            setColdOpen(false);
            markColdNoteSeen();
          },
        }}
        onDismiss={() => {
          setColdOpen(false);
          markColdNoteSeen();
        }}
      />
      {/* Paused, but the car is moving */}
      <Popup
        visible={resumeAsk && paused}
        tone={C.green}
        icon={<Play size={26} color={C.green} fill={C.green} />}
        title="Driving again?"
        body="Your drive is paused, but you're moving. Resume so the km and range keep counting."
        primary={{
          label: 'Resume drive',
          onPress: () => {
            setResumeAsk(false);
            Trip.resumeTrip();
          },
        }}
        secondary={{
          label: 'Not now',
          onPress: () => {
            setResumeAsk(false);
            resumeSnoozeUntil.current = Date.now() + 10 * 60 * 1000;
          },
        }}
        onDismiss={() => {
          setResumeAsk(false);
          resumeSnoozeUntil.current = Date.now() + 10 * 60 * 1000;
        }}
      />
      {/* Pop-ups: one at a time — tracking tip first, then the charge question */}
      <Popup
        visible={bgWarning === 'web' && Platform.OS === 'web'}
        tone={C.amber}
        icon={<MapPinOff size={26} color={C.amber} strokeWidth={2.2} />}
        title="Keep this screen open"
        body="The screen stays on while you drive. If you switch apps, the browser pauses GPS — the km you drove are recovered from your position when you come back."
        primary={{ label: 'OK', onPress: () => setBgWarning(null) }}
        secondary={{
          label: 'Don’t show again',
          onPress: () => {
            kv.setItem('ev_hide_web_bg_tip', '1').catch(() => {});
            setBgWarning(null);
          },
        }}
        onDismiss={() => setBgWarning(null)}
      />
      <Popup
        visible={bgWarning === 'native'}
        tone={C.green}
        icon={<MapPin size={26} color={C.green} strokeWidth={2.2} />}
        title="Keep tracking with the screen off"
        body="Range Pilot collects location data to measure your distance, speed and range during a drive, even when the app is closed or not in use. Location is only used while a drive is running, and your trips are saved only on your phone. On the next screen, choose “Allow all the time”."
        primary={{
          label: 'Continue',
          onPress: () => {
            kv.setItem('ev_bg_permission_asked', '1').catch(() => {});
            setBgWarning(null);
            requestBackgroundPermission().catch(() => {});
          },
        }}
        secondary={{
          label: 'Not now',
          onPress: () => {
            kv.setItem('ev_bg_permission_asked', '1').catch(() => {});
            setBgWarning(null);
          },
        }}
        onDismiss={() => {
          kv.setItem('ev_bg_permission_asked', '1').catch(() => {});
          setBgWarning(null);
        }}
      />
      <Popup
        visible={!bgWarning && !(coldOpen && cold) && !!chargePrompt && !chargeSheet}
        tone={C.green}
        icon={<Zap size={26} color={C.green} fill={C.green} />}
        title={chargePrompt ? `Looks like you charged ${chargePrompt.from}% → ${chargePrompt.to}%` : ''}
        body="Add what you paid and your trip costs will use your real price."
        primary={{ label: 'Add charge', onPress: () => setChargeSheet(true) }}
        secondary={{ label: 'Not now', onPress: () => setChargePrompt(null) }}
        onDismiss={() => setChargePrompt(null)}
      />

      <ChargeSheet
        visible={chargeSheet}
        capacityKwh={trip.batteryCapacity}
        currency={currency}
        initialFrom={chargePrompt?.from}
        initialTo={chargePrompt?.to}
        onClose={() => {
          setChargeSheet(false);
          setChargePrompt(null);
        }}
        onSaved={() => {
          setChargeSheet(false);
          setChargePrompt(null);
          showToast('Charge saved — trip costs now use your real price', 'green');
        }}
      />
      <DestinationSheet
        visible={destSheet}
        near={trip.lastFix ? { lat: trip.lastFix.lat, lon: trip.lastFix.lon } : null}
        onClose={() => setDestSheet(false)}
        onPick={(p) => {
          setDestSheet(false);
          routeTo(p);
        }}
      />
      {obdOwnPicker && <ObdPicker visible={obdPicker} onClose={() => setObdPicker(false)} />}
      <NumberSheet
        visible={batterySheet}
        title="Battery level"
        subtitle="Enter the % your car shows right now"
        initial={snap.battery}
        unit="%"
        min={0}
        max={100}
        onConfirm={onBattery}
        onClose={() => setBatterySheet(false)}
      />
      <NumberSheet
        visible={consSheet}
        title="Consumption"
        subtitle="From your car's trip computer, if you have it"
        initial={snap.consumption}
        unit="kWh/100 km"
        min={5}
        max={50}
        onConfirm={(v) => {
          setConsSheet(false);
          Trip.setConsumption(v);
        }}
        onClose={() => setConsSheet(false)}
      />
      <FinishSheet
        visible={finishOpen}
        snap={snap}
        onClose={() => setFinishOpen(false)}
        onSave={async (endBattery) => {
          setFinishOpen(false);
          const saved = await Trip.finishTrip(endBattery);
          if (saved) router.replace({ pathname: '/trip-summary', params: { tripId: saved.id } });
          else router.replace('/');
        }}
        onDiscard={async () => {
          setFinishOpen(false);
          await Trip.discardTrip();
          router.replace('/');
        }}
      />
    </View>
  );
}

/** Speed colour: green up to 90 km/h, yellow 90–110, red above 110. */
/** "419 km · 4 h 34 min" still to go to the destination */
function destLine(trip: NonNullable<ReturnType<typeof Trip.getTrip>>): string {
  const d = trip.destination;
  if (!d) return '';
  const km = destinationRemainingKm(trip) ?? d.routeKm;
  const min = d.routeKm > 0 ? (d.minutes * km) / d.routeKm : 0;
  const time = min >= 60 ? `${Math.floor(min / 60)} h ${Math.round(min % 60)} min` : `${Math.round(min)} min`;
  return `${km.toFixed(0)} km · ${time}`;
}

function speedColor(kmh: number) {
  if (kmh > 110) return C.red;
  if (kmh >= 90) return C.amber;
  return C.green;
}

/** Battery drawing that fills with the charge level; the % is always readable. */
function BatteryGauge({ pct, moving, charging }: { pct: number; moving: boolean; charging: boolean }) {
  const p = Math.max(0, Math.min(100, pct));
  const color = batteryColor(p);
  const [h, setH] = useState(0);
  const [w, setW] = useState(0);
  // the number sits inside the fill when it fits, above the fill when the
  // battery is low, and on a dark plate when it would straddle the edge
  const NUM = 58;
  const fillPx = (h * p) / 100;
  const place = h === 0 || fillPx >= NUM ? 'fill' : h - fillPx >= NUM ? 'empty' : 'middle';
  const ink = place === 'fill' ? C.onAccent : C.text;
  return (
    <View style={styles.gauge}>
      <View style={styles.gaugeCap} />
      <View
        style={styles.gaugeBody}
        onLayout={(e) => {
          setH(e.nativeEvent.layout.height);
          setW(e.nativeEvent.layout.width);
        }}
      >
        <LiquidFill pct={p} color={color} width={w} height={h} moving={moving} charging={charging} />
        <View
          style={[
            styles.gaugeNum,
            place === 'fill'
              ? { bottom: Math.max(2, (fillPx - NUM) / 2) }
              : place === 'empty'
                ? { top: Math.max(2, (h - fillPx - NUM) / 2) }
                : styles.gaugeNumMid,
          ]}
        >
          <Text style={[styles.gaugeValue, { color: ink }]}>{p.toFixed(0)}</Text>
          <Text style={[styles.gaugePct, { color: ink }]}>%</Text>
        </View>
      </View>
    </View>
  );
}

function Stat({ value, unit, label, color }: { value: string; unit?: string; label: string; color?: string }) {
  return (
    <View style={styles.stat}>
      <Text style={[styles.statValue, color ? { color } : null]} numberOfLines={1}>
        {value}
      </Text>
      {unit ? <Text style={styles.statUnit}>{unit}</Text> : null}
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

function FinishSheet({
  visible,
  snap,
  onClose,
  onSave,
  onDiscard,
}: {
  visible: boolean;
  snap: Snapshot;
  onClose: () => void;
  onSave: (endBattery: number) => void;
  onDiscard: () => void;
}) {
  const [battery, setBattery] = useState(snap.battery);
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const [typing, setTyping] = useState(false);
  useEffect(() => {
    if (visible) {
      setBattery(Math.round(snap.battery * 10) / 10);
      setConfirmDiscard(false);
    }
  }, [visible]);
  const clamp = (v: number) => Math.max(0, Math.min(100, Math.round(v * 10) / 10));
  return (
    <>
      <Modal visible={visible && !typing} transparent animationType="slide" onRequestClose={onClose}>
        <Pressable style={styles.overlay} onPress={onClose}>
          <Pressable style={styles.sheet} onPress={(e) => e.stopPropagation()}>
            <View style={styles.grab} />
            <View style={styles.sheetHead}>
              <Text style={styles.sheetTitle}>Finish drive</Text>
              <Text style={styles.sheetSub}>
                {snap.distanceKm.toFixed(1)} km · {formatDuration(snap.elapsedSec)}
              </Text>
            </View>
            <Text style={styles.sheetLabel}>Battery your car shows now</Text>
            <Stepper
              size="lg"
              value={`${battery.toFixed(1)}%`}
              color={batteryColor(battery)}
              onMinus={() => setBattery((b) => clamp(b - 1))}
              onPlus={() => setBattery((b) => clamp(b + 1))}
              onMinusLong={() => setBattery((b) => clamp(b - 5))}
              onPlusLong={() => setBattery((b) => clamp(b + 5))}
              onPressValue={() => setTyping(true)}
            />
            <Text style={styles.sheetHint}>This gives you the real consumption of the trip.</Text>
            <TouchableOpacity style={styles.saveBtn} onPress={() => onSave(battery)} activeOpacity={0.85}>
              <Text style={styles.saveText}>Save trip</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.cancelBtn} onPress={onClose} activeOpacity={0.7}>
              <Text style={styles.cancelText}>Keep driving</Text>
            </TouchableOpacity>
            {confirmDiscard ? (
              <TouchableOpacity style={styles.discardBtn} onPress={onDiscard} activeOpacity={0.7}>
                <Text style={[styles.discardText, { color: C.red }]}>Tap again to delete this drive</Text>
              </TouchableOpacity>
            ) : (
              <TouchableOpacity
                style={styles.discardBtn}
                onPress={() => setConfirmDiscard(true)}
                activeOpacity={0.7}
              >
                <Text style={styles.discardText}>Discard without saving</Text>
              </TouchableOpacity>
            )}
          </Pressable>
        </Pressable>
      </Modal>
      <NumberSheet
        visible={visible && typing}
        title="Battery at the end"
        initial={battery}
        unit="%"
        min={0}
        max={100}
        onConfirm={(v) => {
          setBattery(v);
          setTyping(false);
        }}
        onClose={() => setTyping(false)}
      />
    </>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: C.bg },
  center: { alignItems: 'center', justifyContent: 'center' },
  loading: { color: C.textDim, fontFamily: F.medium, fontSize: 15 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  headerBtn: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  headerTitle: { fontSize: 19, fontFamily: F.displayBold, color: C.text, letterSpacing: -0.3 },
  headerSub: { fontSize: 12, fontFamily: F.regular, color: C.textDim, marginTop: 1 },
  gpsPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 11,
    paddingVertical: 7,
    borderRadius: 20,
    maxWidth: 200,
  },
  gpsDot: { width: 7, height: 7, borderRadius: 4 },
  gpsText: { fontSize: 12, fontFamily: F.semibold },
  scroll: { paddingHorizontal: 18, paddingTop: 6 },
  mapBody: { flex: 1, paddingHorizontal: 18, paddingTop: 6 },
  viewSwitch: {
    flexDirection: 'row',
    backgroundColor: C.card,
    borderWidth: 1,
    borderColor: C.border,
    borderRadius: 12,
    padding: 3,
    marginLeft: 10,
  },
  viewBtn: { paddingHorizontal: 12, paddingVertical: 7, borderRadius: 9 },
  viewBtnOn: { backgroundColor: C.blue },
  viewText: { fontSize: 13, fontFamily: F.semibold, color: C.textDim },
  viewTextOn: { color: C.onAccent },
  warn: {
    flexDirection: 'row',
    gap: 10,
    alignItems: 'flex-start',
    backgroundColor: C.amberDim,
    borderColor: C.amber + '44',
    borderWidth: 1,
    borderRadius: 16,
    padding: 14,
    marginBottom: 12,
  },
  warnTitle: { color: C.text, fontFamily: F.semibold, fontSize: 14 },
  warnBody: { color: C.textDim, fontFamily: F.regular, fontSize: 12.5, lineHeight: 18, marginTop: 3 },
  warnAction: { color: C.amber, fontFamily: F.bold, fontSize: 13, marginTop: 8 },
  hero: {
    backgroundColor: C.card,
    borderRadius: 24,
    padding: 22,
    borderWidth: 1,
    borderColor: C.border,
    marginBottom: 12,
  },
  heroTop: { flexDirection: 'row', alignItems: 'center' },
  coldSpot: { position: 'absolute', top: 0, right: 0 },
  chargeSpot: { position: 'absolute', left: -12, top: 132, width: 88, alignItems: 'center' },
  flank: { position: 'absolute', top: 40, width: 84, alignItems: 'center' },
  flankValue: { fontSize: 34, lineHeight: 38, fontFamily: F.display, color: C.text, letterSpacing: -1.4 },
  flankLabel: { fontSize: 13, fontFamily: F.semibold, color: C.textDim, marginTop: 0 },
  perTen: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: C.card,
    borderWidth: 1,
    borderColor: C.border,
    borderRadius: 18,
    paddingVertical: 12,
    marginTop: 12,
  },
  perTenValue: { fontSize: 22, lineHeight: 26, fontFamily: F.display, color: C.text, letterSpacing: -0.6 },
  perTenLabel: { fontSize: 13, fontFamily: F.medium, color: C.textDim },
  seg: {
    flexDirection: 'row',
    gap: 4,
    padding: 3,
    marginTop: 12,
    backgroundColor: C.card,
    borderWidth: 1,
    borderColor: C.border,
    borderRadius: 14,
  },
  segBtn: { flex: 1, height: 44, borderRadius: 11, alignItems: 'center', justifyContent: 'center' },
  segBtnOn: { backgroundColor: C.green },
  segText: { fontSize: 14, fontFamily: F.bold, color: C.text },
  segTextOn: { color: C.onAccent },
  trio: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 12 },
  tile: {
    flex: 1,
    height: 196,
    backgroundColor: C.card,
    borderWidth: 1,
    borderColor: C.border,
    borderRadius: 20,
    padding: 12,
    justifyContent: 'space-between',
  },
  tileTitle: { fontSize: 13, fontFamily: F.semibold, color: C.text },
  tileNote: { fontSize: 12, fontFamily: F.semibold },
  tileUnit: { fontSize: 12, fontFamily: F.medium, color: C.textDim, marginTop: 1 },
  consBig: { fontSize: 38, lineHeight: 42, fontFamily: F.display, color: C.text, letterSpacing: -1.4 },
  pm: { flexDirection: 'row', gap: 8 },
  pmBtn: {
    flex: 1,
    height: 44,
    borderRadius: 12,
    backgroundColor: C.cardHi,
    alignItems: 'center',
    justifyContent: 'center',
  },
  obdCol: { width: 100, alignItems: 'center', gap: 8 },
  power: {
    width: 92,
    height: 92,
    borderRadius: 46,
    borderWidth: 8,
    backgroundColor: C.bg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  obdLabel: { fontSize: 12, fontFamily: F.bold, textAlign: 'center' },
  obdError: { fontSize: 12, fontFamily: F.medium, color: C.amber, textAlign: 'center', marginTop: 8 },
  gauge: { flex: 1, alignItems: 'center', marginVertical: 8 },
  gaugeCap: { width: 34, height: 7, backgroundColor: C.borderHi, borderTopLeftRadius: 4, borderTopRightRadius: 4 },
  gaugeBody: { flex: 1, alignSelf: 'stretch', backgroundColor: C.cardHi, borderRadius: 16, overflow: 'hidden' },
  gaugeFill: { position: 'absolute', left: 0, right: 0, bottom: 0 },
  gaugeNum: { position: 'absolute', left: 0, right: 0, alignItems: 'center' },
  gaugeNumMid: {
    top: 4,
    bottom: 4,
    left: 10,
    right: 10,
    justifyContent: 'center',
    borderRadius: 12,
    backgroundColor: 'rgba(11,14,17,0.78)',
  },
  gaugeValue: { fontSize: 38, lineHeight: 40, fontFamily: F.display, letterSpacing: -1.4 },
  gaugePct: { fontSize: 13, lineHeight: 14, fontFamily: F.bold },
  strip: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: C.card,
    borderWidth: 1,
    borderColor: C.border,
    borderRadius: 18,
    paddingVertical: 12,
    marginTop: 12,
  },
  stripCell: { flex: 1, alignItems: 'center' },
  stripDivider: { borderLeftWidth: 1, borderLeftColor: C.border },
  stripValue: { fontSize: 24, lineHeight: 28, fontFamily: F.display, color: C.text, letterSpacing: -0.6 },
  stripLabel: { fontSize: 12, fontFamily: F.medium, color: C.textDim, marginTop: 1 },
  heroRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 12 },
  consBox: {
    alignItems: 'center',
    borderWidth: 1,
    borderRadius: 16,
    paddingVertical: 10,
    paddingHorizontal: 12,
    minWidth: 88,
    marginTop: 2,
  },
  consValue: { fontSize: 26, fontFamily: F.bold, letterSpacing: -0.8 },
  consUnit: { fontSize: 11, fontFamily: F.medium, color: C.textDim, marginTop: 1 },
  per10Pill: {
    marginTop: 8,
    borderRadius: 12,
    paddingVertical: 7,
    paddingHorizontal: 10,
    alignItems: 'center',
    backgroundColor: C.blue + '1F',
    borderWidth: 1,
    borderColor: C.blue + '44',
  },
  per10PillValue: { fontSize: 15, fontFamily: F.bold, color: C.text },
  per10PillUnit: { fontSize: 12, fontFamily: F.semibold, color: C.blue },
  per10PillSub: { fontSize: 10.5, fontFamily: F.medium, color: C.textDim, marginTop: 1 },
  consSpeed: { fontSize: 10, fontFamily: F.medium, color: C.textMute, marginTop: 2 },
  chargeCard: {
    flexDirection: 'row',
    gap: 10,
    alignItems: 'flex-start',
    backgroundColor: C.greenDim,
    borderColor: C.green + '55',
    borderWidth: 1,
    borderRadius: 16,
    padding: 14,
    marginBottom: 12,
  },
  chargeAdd: { backgroundColor: C.green, borderRadius: 10, paddingVertical: 8, paddingHorizontal: 14 },
  chargeAddText: { color: '#06240F', fontFamily: F.bold, fontSize: 13.5 },
  usual: {
    flexDirection: 'row',
    gap: 10,
    alignItems: 'flex-start',
    backgroundColor: C.blueDim,
    borderColor: C.blue + '55',
    borderWidth: 1,
    borderRadius: 16,
    padding: 14,
    marginBottom: 12,
  },
  usualTitle: { color: C.text, fontFamily: F.semibold, fontSize: 14, lineHeight: 19 },
  usualBody: { color: C.textDim, fontFamily: F.regular, fontSize: 12.5, marginTop: 3 },
  usualActions: { flexDirection: 'row', alignItems: 'center', gap: 16, marginTop: 10 },
  usualUse: { backgroundColor: C.blue, borderRadius: 10, paddingVertical: 8, paddingHorizontal: 14 },
  usualUseText: { color: C.onAccent, fontFamily: F.semibold, fontSize: 13.5 },
  usualSkip: { color: C.textDim, fontFamily: F.medium, fontSize: 13.5 },
  cold: {
    flexDirection: 'row',
    gap: 10,
    alignItems: 'flex-start',
    backgroundColor: '#0F1A22',
    borderColor: '#7DD3FC44',
    borderWidth: 1,
    borderRadius: 16,
    padding: 14,
    marginBottom: 12,
  },
  coldTitle: { color: C.text, fontFamily: F.semibold, fontSize: 14 },
  coldBody: { color: C.textDim, fontFamily: F.regular, fontSize: 12.5, lineHeight: 18, marginTop: 3 },
  consLearned: { flexDirection: 'row', alignItems: 'center', gap: 3, marginTop: 4 },
  consLearnedText: { fontSize: 10, fontFamily: F.semibold },
  heroLabel: {
    fontSize: 12,
    fontFamily: F.semibold,
    color: C.textDim,
    letterSpacing: 1,
    textTransform: 'uppercase',
  },
  heroValue: { fontSize: 92, fontFamily: F.display, letterSpacing: -4.5, lineHeight: 92, marginTop: 6 },
  heroUnit: { fontSize: 26, fontFamily: F.displayBold, color: C.textDim, letterSpacing: -0.5 },
  liveBatt: { alignItems: 'center', marginTop: 14 },
  liveBattValue: { fontSize: 44, fontFamily: F.display, letterSpacing: -1.6, lineHeight: 48 },
  liveRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 2 },
  liveDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: C.green },
  liveText: { fontSize: 12, fontFamily: F.semibold, color: C.textDim },
  obdReconnect: { alignSelf: 'center', marginTop: 10, paddingVertical: 8, paddingHorizontal: 14, borderRadius: 999, backgroundColor: C.cardHi },
  obdReconnectText: { fontSize: 12.5, fontFamily: F.semibold, color: C.text },
  facts: { flexDirection: 'row', borderTopWidth: 1, borderBottomWidth: 1, borderColor: C.border, marginTop: 14 },
  fact: { flex: 1, paddingVertical: 12 },
  factDivider: { borderLeftWidth: 1, borderLeftColor: C.border, paddingLeft: 14 },
  factValue: { fontSize: 20, fontFamily: F.displayBold, color: C.text, letterSpacing: -0.5 },
  factLabel: { fontSize: 12, fontFamily: F.medium, color: C.textDim, marginTop: 1 },
  factSub: { fontSize: 10.5, fontFamily: F.medium, color: C.textMute, marginTop: 1 },
  reserveRow: { gap: 10, marginTop: 6 },
  reserveLabel: { fontSize: 12, fontFamily: F.semibold, color: C.textDim, letterSpacing: 1, textTransform: 'uppercase' },
  battTrack: {
    height: 8,
    borderRadius: 4,
    backgroundColor: C.border,
    overflow: 'hidden',
    marginTop: 12,
  },
  battFill: { height: '100%', borderRadius: 5 },
  reserveMark: { position: 'absolute', top: 0, bottom: 0, width: 2, backgroundColor: C.bg },
  heroMeta: { flexDirection: 'row', alignItems: 'baseline', gap: 10, marginTop: 10, flexWrap: 'wrap' },
  heroMetaStrong: { fontSize: 18, fontFamily: F.bold },
  heroMetaText: { fontSize: 13, fontFamily: F.medium, color: C.textDim },
  statsRow: { flexDirection: 'row', gap: 10, marginBottom: 6 },
  destBtn: {
    marginTop: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    borderRadius: 18,
    backgroundColor: C.card,
    paddingVertical: 16,
    marginBottom: 12,
  },
  destBtnText: { fontSize: 15, fontFamily: F.semibold, color: C.text },
  per10: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: C.blueDim,
    borderColor: C.blue + '55',
    borderWidth: 1,
    borderRadius: 20,
    paddingVertical: 14,
    paddingHorizontal: 18,
    marginBottom: 12,
  },
  per10Right: { alignItems: 'flex-end', borderLeftWidth: 1, borderLeftColor: C.blue + '40', paddingLeft: 16 },
  per10Label: { fontSize: 12, fontFamily: F.semibold, color: '#8B95A1', letterSpacing: 0.4 },
  per10Value: { fontSize: 40, fontFamily: F.bold, color: C.text, letterSpacing: -1.5, lineHeight: 46 },
  per10Next: { fontSize: 28, fontFamily: F.bold, color: C.text, letterSpacing: -1, lineHeight: 34 },
  per10Unit: { fontSize: 16, color: C.blue, letterSpacing: 0 },
  per10Sub: { fontSize: 11.5, fontFamily: F.medium, color: C.textDim, marginTop: 1 },
  stat: {
    flex: 1,
    backgroundColor: C.card,
    borderRadius: 16,
    paddingVertical: 14,
    paddingHorizontal: 8,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: C.border,
  },
  statValue: { fontSize: 22, fontFamily: F.bold, color: C.text, letterSpacing: -0.6 },
  statUnit: { fontSize: 12, fontFamily: F.medium, color: C.textDim, letterSpacing: 0 },
  statLabel: { fontSize: 11, fontFamily: F.medium, color: C.textMute, marginTop: 1 },
  estNote: {
    fontSize: 11.5,
    fontFamily: F.medium,
    color: C.textMute,
    textAlign: 'center',
    marginTop: 2,
    marginBottom: 6,
  },
  hint: { fontSize: 12, fontFamily: F.regular, color: C.textMute, marginTop: 8, lineHeight: 17, textAlign: 'center' },
  learnedBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: C.blueDim,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 10,
  },
  learnedText: { fontSize: 11, fontFamily: F.semibold, color: '#8B95A1' },
  bottom: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    flexDirection: 'row',
    gap: 12,
    paddingHorizontal: 22,
    paddingTop: 10,
    backgroundColor: C.bg,
  },
  ctrl: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    borderRadius: 18,
    height: 58,
  },
  pause: { backgroundColor: C.cardHi },
  resume: { backgroundColor: C.blue },
  finish: { backgroundColor: C.redDim },
  ctrlText: { fontSize: 16, fontFamily: F.semibold, color: C.text },
  ctrlTextLight: { fontSize: 16, fontFamily: F.bold, color: C.onAccent },
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.62)',
    justifyContent: 'flex-end',
    alignItems: 'center',
  },
  sheet: {
    width: '100%',
    maxWidth: 520,
    backgroundColor: C.card,
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    paddingHorizontal: 22,
    paddingTop: 10,
    paddingBottom: 28,
  },
  grab: { width: 40, height: 4, borderRadius: 2, backgroundColor: C.borderHi, alignSelf: 'center', marginBottom: 18 },
  sheetHead: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between' },
  sheetTitle: { fontSize: 26, fontFamily: F.display, color: C.text, letterSpacing: -0.8 },
  sheetSub: { fontSize: 14, fontFamily: F.medium, color: C.textDim },
  sheetLabel: {
    fontSize: 12,
    fontFamily: F.semibold,
    color: C.textDim,
    textTransform: 'uppercase',
    letterSpacing: 1,
    marginTop: 22,
    marginBottom: 12,
  },
  sheetHint: { fontSize: 12, fontFamily: F.regular, color: C.textMute, textAlign: 'center', marginTop: 10 },
  saveBtn: {
    backgroundColor: C.blue,
    borderRadius: 18,
    height: 58,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 18,
  },
  saveText: { fontSize: 17, fontFamily: F.bold, color: C.onAccent },
  cancelBtn: { height: 54, borderRadius: 18, backgroundColor: C.cardHi, alignItems: 'center', justifyContent: 'center', marginTop: 8 },
  cancelText: { fontSize: 16, fontFamily: F.semibold, color: C.text },
  discardBtn: { paddingVertical: 12, alignItems: 'center', marginTop: 6 },
  discardText: { fontSize: 14, fontFamily: F.semibold, color: C.textDim },
});
