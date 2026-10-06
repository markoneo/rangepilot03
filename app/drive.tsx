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
import { ChevronDown, Pause, Play, Flag, Zap, MapPinOff, X, Sparkles, Search } from 'lucide-react-native';
import { ArrivalCard, DestinationSheet } from '@/components/destination';
import { computeRoute, routeElevation, estimateArrival, type Place } from '@/utils/maps';
import { destinationRemainingKm } from '@/utils/trackCore';
import { getCurrentPosition } from '@/utils/geolocation';
import { readJSON, kv } from '@/utils/kv';
import {
  getBackgroundPermissionStatus,
  getPermissionStatus,
  requestBackgroundPermission,
} from '@/utils/geolocation';
import { loadAppState, loadCarSettings, loadPrefs, formatDuration } from '@/utils/storage';
import * as Trip from '@/utils/tripTracker';
import type { Snapshot } from '@/utils/tripTracker';
import { C, F, batteryColor } from '@/constants/theme';
import { Card, Chips, Label, NumberSheet, Stepper, Toast, tap } from '@/components/ui';

const KEEP_AWAKE_TAG = 'range-pilot-drive';
const RESERVE_OPTIONS = [0, 5, 10, 15, 20];

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
  const params = useLocalSearchParams<{ start?: string }>();
  const snap = useTripSnapshot();
  const trip = Trip.getTrip();

  const [ready, setReady] = useState(false);
  const [toast, setToast] = useState<{ text: string; tone: 'green' | 'blue' | 'amber' } | null>(null);
  const [batterySheet, setBatterySheet] = useState(false);
  const [consSheet, setConsSheet] = useState(false);
  const [finishOpen, setFinishOpen] = useState(false);
  const [bgWarning, setBgWarning] = useState<'native' | 'web' | null>(null);
  const [destSheet, setDestSheet] = useState(false);
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
      });
    } finally {
      routingRef.current = false;
      setRouting(false);
    }
  };

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
        });
        const pending = await readJSON<Place>('ev_pending_destination');
        if (pending) {
          await kv.removeItem('ev_pending_destination');
          routeTo(pending);
        }
      }
      setReady(true);
      const bg = await getBackgroundPermissionStatus();
      if (bg === 'denied') setBgWarning('native');
      else if (bg === 'unsupported') setBgWarning('web');
    })();
  }, []);

  // Keep the screen on while a drive exists.
  const hasTrip = !!snap;
  useEffect(() => {
    if (!hasTrip) return;
    const on = () => {
      activateKeepAwakeAsync(KEEP_AWAKE_TAG).catch(() => {});
    };
    on();
    const sub = AppState.addEventListener('change', (st) => {
      if (st === 'active') on();
    });
    let visHandler: (() => void) | null = null;
    if (Platform.OS === 'web' && typeof document !== 'undefined') {
      visHandler = () => {
        if (document.visibilityState === 'visible') on();
      };
      document.addEventListener('visibilitychange', visHandler);
    }
    return () => {
      sub.remove();
      if (visHandler) document.removeEventListener('visibilitychange', visHandler);
      try {
        deactivateKeepAwake(KEEP_AWAKE_TAG);
      } catch {
        // ignore
      }
    };
  }, [hasTrip]);

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
      if (km >= 0.1) showToast(`GPS back — added ${km.toFixed(1)} km for the gap`, 'green');
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
  const bColor = batteryColor(snap.battery);
  const kwhLeft = (trip.batteryCapacity * snap.usableBattery) / 100;
  // km per 10 % of battery at the current (or learned) consumption
  const kmPer10 = snap.consumption > 0 ? (trip.batteryCapacity * 0.1 * 100) / snap.consumption : 0;
  const nextMark = Math.max(0, Math.ceil(snap.battery / 10) * 10 - 10);
  const kmToNextMark = ((snap.battery - nextMark) / 10) * kmPer10;

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
    const r = await Trip.setBattery(v);
    if (r.learned != null) {
      showToast(`Consumption updated to ${r.learned.toFixed(1)} kWh/100 km from your battery`, 'blue');
    }
  };

  const stepBattery = (d: number) => {
    Trip.setBattery(Math.round((snap.battery + d) * 10) / 10);
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
            {trip.carName}
          </Text>
          <Text style={styles.headerSub}>{paused ? 'Drive paused' : 'Drive in progress'}</Text>
        </View>
        <View style={[styles.gpsPill, { backgroundColor: gps.bg }]}>
          <View style={[styles.gpsDot, { backgroundColor: gps.fg }]} />
          <Text style={[styles.gpsText, { color: gps.fg }]} numberOfLines={1}>
            {gps.label}
          </Text>
        </View>
      </View>

      <Toast text={toast?.text ?? null} tone={toast?.tone} />

      <ScrollView
        contentContainerStyle={[styles.scroll, { paddingBottom: 120 + insets.bottom }]}
        showsVerticalScrollIndicator={false}
      >
        {bgWarning === 'native' && (
          <View style={styles.warn}>
            <MapPinOff size={18} color={C.amber} strokeWidth={2.2} />
            <View style={{ flex: 1 }}>
              <Text style={styles.warnTitle}>Tracking stops when the screen is off</Text>
              <Text style={styles.warnBody}>
                Allow location “Always” so km keep counting in your pocket. Missed km are still
                recovered when you come back.
              </Text>
              <TouchableOpacity
                onPress={async () => {
                  const ok = await requestBackgroundPermission();
                  if (ok) {
                    setBgWarning(null);
                    showToast('Background tracking enabled', 'green');
                  } else if (Platform.OS === 'ios') Linking.openURL('app-settings:');
                  else Linking.openSettings();
                }}
                activeOpacity={0.8}
              >
                <Text style={styles.warnAction}>Allow “Always”</Text>
              </TouchableOpacity>
            </View>
            <TouchableOpacity onPress={() => setBgWarning(null)} hitSlop={10}>
              <X size={16} color={C.textMute} />
            </TouchableOpacity>
          </View>
        )}
        {bgWarning === 'web' && (
          <View style={styles.warn}>
            <MapPinOff size={18} color={C.amber} strokeWidth={2.2} />
            <View style={{ flex: 1 }}>
              <Text style={styles.warnTitle}>Keep this screen open</Text>
              <Text style={styles.warnBody}>
                Browsers pause GPS when you switch apps. When you come back, the km you drove are
                recovered from your position. Install the app for full background tracking.
              </Text>
            </View>
            <TouchableOpacity onPress={() => setBgWarning(null)} hitSlop={10}>
              <X size={16} color={C.textMute} />
            </TouchableOpacity>
          </View>
        )}

        {/* HERO: range */}
        <View style={styles.hero}>
          <View style={styles.heroTop}>
            <Zap size={14} color={C.blue} fill={C.blue} />
            <Text style={styles.heroLabel}>
              {snap.reservePercent > 0 ? `Range to ${snap.reservePercent}%` : 'Range left'}
            </Text>
          </View>
          <Text style={[styles.heroValue, { color: snap.usableBattery <= 0 ? C.red : C.text }]}>
            {Math.round(snap.rangeKm)}
            <Text style={styles.heroUnit}> km</Text>
          </Text>
          <View style={styles.battTrack}>
            <View
              style={[
                styles.battFill,
                { width: `${Math.max(0, Math.min(100, snap.battery))}%`, backgroundColor: bColor },
              ]}
            />
            {snap.reservePercent > 0 && (
              <View style={[styles.reserveMark, { left: `${snap.reservePercent}%` }]} />
            )}
          </View>
          <View style={styles.heroMeta}>
            <Text style={[styles.heroMetaStrong, { color: bColor }]}>{snap.battery.toFixed(1)}%</Text>
            <Text style={styles.heroMetaText}>
              {kwhLeft.toFixed(1)} kWh usable · {snap.consumption.toFixed(1)} kWh/100
            </Text>
          </View>
        </View>

        {/* Can I make it? */}
        {trip.destination ? (
          (() => {
            const dest = trip.destination!;
            const remaining = destinationRemainingKm(trip) ?? dest.routeKm;
            const frac = dest.routeKm > 0 ? remaining / dest.routeKm : 0;
            const est = estimateArrival({
              capacityKwh: trip.batteryCapacity,
              batteryPct: snap.battery,
              consumption: snap.consumption,
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

        {/* km per 10 % — quick mental range check */}
        <View style={styles.per10}>
          <View style={{ flex: 1 }}>
            <Text style={styles.per10Label}>10% battery =</Text>
            <Text style={styles.per10Value}>
              {kmPer10.toFixed(0)}
              <Text style={styles.per10Unit}> km</Text>
            </Text>
            <Text style={styles.per10Sub}>
              1% = {(kmPer10 / 10).toFixed(1)} km
              {snap.measuredConsumption != null ? ' · from your battery' : ''}
            </Text>
          </View>
          {snap.battery > 0.5 && (
            <View style={styles.per10Right}>
              <Text style={styles.per10Label}>{nextMark}% in</Text>
              <Text style={styles.per10Next}>
                {kmToNextMark.toFixed(1)}
                <Text style={styles.per10Unit}> km</Text>
              </Text>
              <Text style={styles.per10Sub}>check your car then</Text>
            </View>
          )}
        </View>

        {/* Live stats */}
        <View style={styles.statsRow}>
          <Stat value={snap.distanceKm.toFixed(1)} label="km driven" />
          <Stat value={formatDuration(snap.elapsedSec)} label="time" />
          <Stat value={paused ? '–' : String(Math.round(snap.speedKmh))} label="km/h" />
        </View>
        {snap.estimatedKm >= 0.1 && (
          <Text style={styles.estNote}>
            {snap.estimatedKm.toFixed(1)} km reconstructed across {snap.gpsGaps} GPS{' '}
            {snap.gpsGaps === 1 ? 'gap' : 'gaps'} (tunnels / background)
          </Text>
        )}

        {/* Battery */}
        <Card style={{ marginTop: 6 }}>
          <Label>Battery — match your car</Label>
          <Stepper
            value={`${snap.battery.toFixed(1)}%`}
            color={bColor}
            onMinus={() => stepBattery(-1)}
            onPlus={() => stepBattery(1)}
            onMinusLong={() => stepBattery(-5)}
            onPlusLong={() => stepBattery(5)}
            onPressValue={() => setBatterySheet(true)}
          />
          <Text style={styles.hint}>
            Correct it whenever your car shows a different %. After 5 km the app learns your real
            consumption from it.
          </Text>
        </Card>

        {/* Consumption */}
        <Card>
          <Label
            right={
              snap.measuredConsumption != null ? (
                <View style={styles.learnedBadge}>
                  <Sparkles size={11} color={C.blue} />
                  <Text style={styles.learnedText}>learned</Text>
                </View>
              ) : null
            }
          >
            Consumption
          </Label>
          <Stepper
            value={snap.consumption.toFixed(1)}
            unit="kWh/100"
            onMinus={() => Trip.setConsumption(snap.consumption - 0.5)}
            onPlus={() => Trip.setConsumption(snap.consumption + 0.5)}
            onMinusLong={() => Trip.setConsumption(snap.consumption - 2)}
            onPlusLong={() => Trip.setConsumption(snap.consumption + 2)}
            onPressValue={() => setConsSheet(true)}
          />
        </Card>

        {/* Reserve */}
        <Card>
          <Label>Arrive with at least</Label>
          <Chips
            options={RESERVE_OPTIONS.map((v) => ({ label: v === 0 ? 'Off' : `${v}%`, value: v }))}
            value={RESERVE_OPTIONS.includes(snap.reservePercent) ? snap.reservePercent : null}
            onChange={(v) => Trip.setReserve(v)}
          />
        </Card>
      </ScrollView>

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
            <Play size={20} color="#fff" fill="#fff" />
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

      <DestinationSheet
        visible={destSheet}
        near={trip.lastFix ? { lat: trip.lastFix.lat, lon: trip.lastFix.lon } : null}
        onClose={() => setDestSheet(false)}
        onPick={(p) => {
          setDestSheet(false);
          routeTo(p);
        }}
      />
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

function Stat({ value, unit, label }: { value: string; unit?: string; label: string }) {
  return (
    <View style={styles.stat}>
      <Text style={styles.statValue} numberOfLines={1}>
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
      <Modal visible={visible && !typing} transparent animationType="fade" onRequestClose={onClose}>
        <Pressable style={styles.overlay} onPress={onClose}>
          <Pressable style={styles.sheet} onPress={(e) => e.stopPropagation()}>
            <Text style={styles.sheetTitle}>Finish drive</Text>
            <Text style={styles.sheetSub}>
              {snap.distanceKm.toFixed(1)} km · {formatDuration(snap.elapsedSec)}
            </Text>
            <Text style={styles.sheetLabel}>Battery your car shows now</Text>
            <Stepper
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
  headerTitle: { fontSize: 17, fontFamily: F.bold, color: C.text, letterSpacing: -0.3 },
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
  scroll: { paddingHorizontal: 16, paddingTop: 8 },
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
  heroTop: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  heroLabel: {
    fontSize: 12,
    fontFamily: F.semibold,
    color: C.textDim,
    letterSpacing: 0.8,
    textTransform: 'uppercase',
  },
  heroValue: { fontSize: 84, fontFamily: F.bold, letterSpacing: -4, lineHeight: 92, marginTop: 4 },
  heroUnit: { fontSize: 28, color: C.blue, letterSpacing: -0.5 },
  battTrack: {
    height: 10,
    borderRadius: 5,
    backgroundColor: C.border,
    overflow: 'hidden',
    marginTop: 10,
  },
  battFill: { height: '100%', borderRadius: 5 },
  reserveMark: { position: 'absolute', top: 0, bottom: 0, width: 2, backgroundColor: C.text },
  heroMeta: { flexDirection: 'row', alignItems: 'baseline', gap: 10, marginTop: 10, flexWrap: 'wrap' },
  heroMetaStrong: { fontSize: 18, fontFamily: F.bold },
  heroMetaText: { fontSize: 13, fontFamily: F.medium, color: C.textDim },
  statsRow: { flexDirection: 'row', gap: 10, marginBottom: 6 },
  destBtn: {
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
  destBtnText: { fontSize: 15, fontFamily: F.semibold, color: C.blue },
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
  per10Label: { fontSize: 12, fontFamily: F.semibold, color: '#93C5FD', letterSpacing: 0.4 },
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
  hint: { fontSize: 12, fontFamily: F.regular, color: C.textMute, marginTop: 12, lineHeight: 17 },
  learnedBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: C.blueDim,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 10,
  },
  learnedText: { fontSize: 11, fontFamily: F.semibold, color: '#93C5FD' },
  bottom: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    flexDirection: 'row',
    gap: 12,
    paddingHorizontal: 16,
    paddingTop: 12,
    backgroundColor: C.bg,
    borderTopWidth: 1,
    borderTopColor: C.border,
  },
  ctrl: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    borderRadius: 16,
    paddingVertical: 17,
  },
  pause: { backgroundColor: C.cardHi, borderWidth: 1, borderColor: C.borderHi },
  resume: { backgroundColor: C.blue },
  finish: { backgroundColor: C.redDim, borderWidth: 1, borderColor: C.red + '55' },
  ctrlText: { fontSize: 16, fontFamily: F.semibold, color: C.text },
  ctrlTextLight: { fontSize: 16, fontFamily: F.semibold, color: '#fff' },
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.6)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  sheet: {
    width: '100%',
    maxWidth: 380,
    backgroundColor: C.card,
    borderRadius: 24,
    padding: 24,
    borderWidth: 1,
    borderColor: C.borderHi,
  },
  sheetTitle: { fontSize: 20, fontFamily: F.bold, color: C.text, textAlign: 'center' },
  sheetSub: { fontSize: 14, fontFamily: F.medium, color: C.textDim, textAlign: 'center', marginTop: 4 },
  sheetLabel: {
    fontSize: 12,
    fontFamily: F.semibold,
    color: C.textDim,
    textTransform: 'uppercase',
    letterSpacing: 0.8,
    textAlign: 'center',
    marginTop: 20,
    marginBottom: 12,
  },
  sheetHint: { fontSize: 12, fontFamily: F.regular, color: C.textMute, textAlign: 'center', marginTop: 10 },
  saveBtn: {
    backgroundColor: C.blue,
    borderRadius: 14,
    paddingVertical: 16,
    alignItems: 'center',
    marginTop: 18,
  },
  saveText: { fontSize: 16, fontFamily: F.semibold, color: '#fff' },
  cancelBtn: { paddingVertical: 13, alignItems: 'center' },
  cancelText: { fontSize: 15, fontFamily: F.medium, color: C.text },
  discardBtn: { paddingVertical: 8, alignItems: 'center' },
  discardText: { fontSize: 13, fontFamily: F.medium, color: C.textMute },
});
