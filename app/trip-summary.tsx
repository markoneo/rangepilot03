import { useState, useEffect } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, ScrollView, LayoutChangeEvent } from 'react-native';
import Svg, { Path, Line, Text as SvgText, Defs, LinearGradient, Stop } from 'react-native-svg';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  CircleCheck,
  Clock,
  Gauge,
  Mountain,
  Thermometer,
  Timer,
  Zap,
  BatteryMedium,
  Info,
  ArrowLeft,
} from 'lucide-react-native';
import { loadTrip, TripRecord, formatDuration, SpeedSample, tripEnergyKwh } from '@/utils/storage';
import { C, F, batteryColor, fmtMoney } from '@/constants/theme';

export default function TripSummaryScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { tripId } = useLocalSearchParams<{ tripId: string }>();
  const [trip, setTrip] = useState<TripRecord | null>(null);
  const [missing, setMissing] = useState(false);

  useEffect(() => {
    (async () => {
      const t = await loadTrip(String(tripId));
      if (t) setTrip(t);
      else setMissing(true);
    })();
  }, [tripId]);

  if (!trip) {
    return (
      <View style={[styles.root, styles.center]}>
        <Text style={styles.muted}>{missing ? 'Trip not found' : 'Loading…'}</Text>
        {missing && (
          <TouchableOpacity onPress={() => router.replace('/')} style={{ marginTop: 16 }}>
            <Text style={{ color: C.blue, fontFamily: F.semibold }}>Back to home</Text>
          </TouchableOpacity>
        )}
      </View>
    );
  }

  const energy = tripEnergyKwh(trip);
  const isReal = trip.realConsumption != null;
  const cons = trip.realConsumption ?? trip.consumption;
  const moving = trip.movingSeconds ?? null;
  const avgSpeed =
    moving && moving > 60
      ? trip.distanceKm / (moving / 3600)
      : trip.durationSeconds > 0
        ? trip.distanceKm / (trip.durationSeconds / 3600)
        : 0;
  const cost = trip.pricePerKwh != null ? energy * trip.pricePerKwh : null;
  const currency = trip.currency ?? '€';
  const start = new Date(trip.startedAt);
  const when = `${start.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' })} · ${start.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}`;

  const details: { icon: React.ReactNode; label: string; value: string }[] = [
    { icon: <Clock size={15} color={C.textDim} />, label: 'Total time', value: formatDuration(trip.durationSeconds) },
  ];
  if (moving != null && moving > 0)
    details.push({ icon: <Timer size={15} color={C.textDim} />, label: 'Moving time', value: formatDuration(moving) });
  details.push({
    icon: <Gauge size={15} color={C.blue} />,
    label: moving ? 'Avg moving speed' : 'Avg speed',
    value: `${Math.round(avgSpeed)} km/h`,
  });
  if (trip.maxSpeedKmh != null)
    details.push({ icon: <Gauge size={15} color={C.amber} />, label: 'Top speed', value: `${Math.round(trip.maxSpeedKmh)} km/h` });
  if (trip.elevationGainM != null && (trip.elevationGainM > 0 || (trip.elevationLossM ?? 0) > 0))
    details.push({
      icon: <Mountain size={15} color={C.green} />,
      label: 'Climb / descent',
      value: `↑${trip.elevationGainM}  ↓${trip.elevationLossM ?? 0} m`,
    });
  else if (trip.minElevationM != null && trip.maxElevationM != null)
    details.push({
      icon: <Mountain size={15} color={C.green} />,
      label: 'Elevation',
      value: `${Math.round(trip.minElevationM)}–${Math.round(trip.maxElevationM)} m`,
    });
  if (trip.minTemperatureC != null && trip.maxTemperatureC != null)
    details.push({
      icon: <Thermometer size={15} color="#60A5FA" />,
      label: 'Outside temp',
      value:
        Math.round(trip.minTemperatureC) === Math.round(trip.maxTemperatureC)
          ? `${Math.round(trip.minTemperatureC)}°C`
          : `${Math.round(trip.minTemperatureC)}–${Math.round(trip.maxTemperatureC)}°C`,
    });
  if (trip.rangeAtEndKm != null)
    details.push({ icon: <BatteryMedium size={15} color={C.green} />, label: 'Range left at end', value: `${trip.rangeAtEndKm} km` });

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={[styles.scroll, { paddingBottom: insets.bottom + 28 }]}
      >
        <View style={styles.topRow}>
          <TouchableOpacity
            onPress={() => (router.canGoBack() ? router.back() : router.replace('/'))}
            style={styles.back}
            activeOpacity={0.7}
          >
            <ArrowLeft size={22} color={C.textDim} />
          </TouchableOpacity>
        </View>

        <View style={styles.header}>
          <CircleCheck size={28} color={C.green} />
          <Text style={styles.title}>{trip.title?.trim() ? trip.title : 'Trip complete'}</Text>
          <Text style={styles.meta}>
            {trip.carName} · {when}
          </Text>
        </View>

        <View style={styles.hero}>
          <Text style={styles.heroValue}>
            {trip.distanceKm.toFixed(1)}
            <Text style={styles.heroUnit}> km</Text>
          </Text>
          <View style={styles.tiles}>
            <Tile
              value={cons.toFixed(1)}
              unit="kWh/100"
              label={isReal ? 'Real consumption' : 'Set consumption'}
              color={isReal ? C.amber : C.text}
            />
            <Tile value={energy.toFixed(1)} unit="kWh" label="Energy used" />
            {cost != null ? (
              <Tile value={fmtMoney(cost, currency)} label="Cost" color={C.green} />
            ) : (
              <Tile value={trip.distanceKm > 0 ? ((energy / trip.distanceKm) * 1000).toFixed(0) : '–'} unit="Wh/km" label="Efficiency" />
            )}
          </View>
        </View>

        {/* Battery strip */}
        <View style={styles.card}>
          <View style={styles.battRow}>
            <Text style={[styles.battNum, { color: batteryColor(trip.startBattery) }]}>{trip.startBattery}%</Text>
            <View style={styles.battTrack}>
              <View
                style={[
                  styles.battUsed,
                  {
                    left: `${Math.max(0, Math.min(100, trip.endBattery))}%`,
                    width: `${Math.max(0, Math.min(100, trip.startBattery - trip.endBattery))}%`,
                  },
                ]}
              />
              <View
                style={[
                  styles.battLeft,
                  {
                    width: `${Math.max(0, Math.min(100, trip.endBattery))}%`,
                    backgroundColor: batteryColor(trip.endBattery),
                  },
                ]}
              />
            </View>
            <Text style={[styles.battNum, { color: batteryColor(trip.endBattery) }]}>
              {trip.endBattery.toFixed(0)}%
            </Text>
          </View>
          <Text style={styles.battCaption}>
            Used {(trip.startBattery - trip.endBattery).toFixed(1)}% of battery
          </Text>
        </View>

        <View style={styles.grid}>
          {details.map((d) => (
            <View key={d.label} style={styles.detail}>
              <View style={styles.detailTop}>
                {d.icon}
                <Text style={styles.detailLabel}>{d.label}</Text>
              </View>
              <Text style={styles.detailValue}>{d.value}</Text>
            </View>
          ))}
        </View>

        {trip.estimatedKm != null && trip.estimatedKm >= 0.1 && (
          <View style={styles.note}>
            <Info size={14} color={C.textDim} />
            <Text style={styles.noteText}>
              {trip.estimatedKm.toFixed(1)} km were reconstructed across {trip.gpsGaps ?? 1} GPS{' '}
              {(trip.gpsGaps ?? 1) === 1 ? 'gap' : 'gaps'} (tunnels or the app in background), using
              road distance between the last and next GPS position.
            </Text>
          </View>
        )}

        {trip.speedSamples && trip.speedSamples.length > 1 && (
          <View style={styles.card}>
            <Text style={styles.cardLabel}>Speed</Text>
            <SpeedCurve samples={trip.speedSamples} />
          </View>
        )}

        {isReal && Math.abs(trip.realConsumption! - trip.consumption) >= 0.1 && (
          <View style={styles.card}>
            <Text style={styles.cardLabel}>Estimate vs. real</Text>
            <View style={styles.cmpRow}>
              <Text style={styles.cmpLabel}>Set in app</Text>
              <Text style={styles.cmpValue}>{trip.consumption.toFixed(1)} kWh/100</Text>
            </View>
            <View style={styles.cmpRow}>
              <Text style={[styles.cmpLabel, { color: C.amber }]}>Real (from battery)</Text>
              <Text style={[styles.cmpValue, { color: C.amber }]}>{trip.realConsumption!.toFixed(1)} kWh/100</Text>
            </View>
            <Text style={styles.cmpNote}>
              {trip.realConsumption! > trip.consumption
                ? 'You used more than estimated — next time pick a higher consumption for safer range.'
                : 'You were more efficient than estimated.'}
            </Text>
          </View>
        )}

        <View style={styles.actions}>
          <TouchableOpacity style={styles.primary} onPress={() => router.replace('/')} activeOpacity={0.85}>
            <Text style={styles.primaryText}>Done</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.secondary} onPress={() => router.replace('/trip-history')} activeOpacity={0.85}>
            <Text style={styles.secondaryText}>All trips</Text>
          </TouchableOpacity>
        </View>
      </ScrollView>
    </View>
  );
}

function Tile({ value, unit, label, color = C.text }: { value: string; unit?: string; label: string; color?: string }) {
  return (
    <View style={styles.tile}>
      <Text style={[styles.tileValue, { color }]} numberOfLines={1}>
        {value}
      </Text>
      {unit ? <Text style={styles.tileUnit}>{unit}</Text> : null}
      <Text style={styles.tileLabel}>{label}</Text>
    </View>
  );
}

export function SpeedCurve({ samples }: { samples: SpeedSample[] }) {
  const [width, setWidth] = useState(0);
  const height = 150;
  const padL = 30;
  const padR = 8;
  const padT = 8;
  const padB = 20;
  const onLayout = (e: LayoutChangeEvent) => setWidth(e.nativeEvent.layout.width);
  if (samples.length < 2 || width === 0) return <View style={{ height }} onLayout={onLayout} />;

  const tMin = samples[0].t;
  const tMax = samples[samples.length - 1].t;
  const tSpan = Math.max(1, tMax - tMin);
  const sMax = Math.max(...samples.map((p) => p.s), 10);
  const niceMax = Math.ceil(sMax / 20) * 20;
  const innerW = width - padL - padR;
  const innerH = height - padT - padB;
  const xAt = (t: number) => padL + ((t - tMin) / tSpan) * innerW;
  const yAt = (s: number) => padT + innerH - (s / niceMax) * innerH;
  let d = `M ${xAt(samples[0].t)} ${yAt(samples[0].s)}`;
  for (let i = 1; i < samples.length; i++) d += ` L ${xAt(samples[i].t)} ${yAt(samples[i].s)}`;
  const area = d + ` L ${xAt(tMax)} ${padT + innerH} L ${xAt(tMin)} ${padT + innerH} Z`;
  const fmt = (sec: number) => {
    const m = Math.floor(sec / 60);
    if (m >= 60) return `${Math.floor(m / 60)}h${String(m % 60).padStart(2, '0')}`;
    return `${m} min`;
  };
  const yTicks = [0, niceMax / 2, niceMax];
  const xTicks = [tMin, tMin + tSpan / 2, tMax];
  return (
    <View style={{ height }} onLayout={onLayout}>
      <Svg width={width} height={height}>
        <Defs>
          <LinearGradient id="speedFill" x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0" stopColor={C.blue} stopOpacity="0.35" />
            <Stop offset="1" stopColor={C.blue} stopOpacity="0" />
          </LinearGradient>
        </Defs>
        {yTicks.map((v) => (
          <Line key={`g${v}`} x1={padL} x2={width - padR} y1={yAt(v)} y2={yAt(v)} stroke={C.border} strokeWidth={1} />
        ))}
        {yTicks.map((v) => (
          <SvgText key={`y${v}`} x={padL - 6} y={yAt(v) + 3} fontSize="10" fill={C.textMute} textAnchor="end">
            {Math.round(v)}
          </SvgText>
        ))}
        {xTicks.map((t, i) => (
          <SvgText
            key={`x${i}`}
            x={xAt(t)}
            y={height - 4}
            fontSize="10"
            fill={C.textMute}
            textAnchor={i === 0 ? 'start' : i === 2 ? 'end' : 'middle'}
          >
            {fmt(t - tMin)}
          </SvgText>
        ))}
        <Path d={area} fill="url(#speedFill)" />
        <Path d={d} stroke={C.blue} strokeWidth={2} fill="none" />
      </Svg>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: C.bg },
  center: { alignItems: 'center', justifyContent: 'center' },
  muted: { color: C.textDim, fontFamily: F.medium },
  scroll: { paddingHorizontal: 16 },
  topRow: { flexDirection: 'row', paddingTop: 4 },
  back: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  header: { alignItems: 'center', marginBottom: 16, gap: 6 },
  title: { fontSize: 22, fontFamily: F.bold, color: C.text, letterSpacing: -0.4, textAlign: 'center' },
  meta: { fontSize: 13, fontFamily: F.regular, color: C.textDim },
  hero: {
    backgroundColor: C.card,
    borderRadius: 24,
    padding: 20,
    borderWidth: 1,
    borderColor: C.border,
    marginBottom: 12,
    alignItems: 'center',
  },
  heroValue: { fontSize: 64, fontFamily: F.bold, color: C.text, letterSpacing: -3 },
  heroUnit: { fontSize: 24, color: C.blue, letterSpacing: -0.5 },
  tiles: { flexDirection: 'row', gap: 8, marginTop: 12, alignSelf: 'stretch' },
  tile: {
    flex: 1,
    backgroundColor: C.cardHi,
    borderRadius: 14,
    paddingVertical: 12,
    paddingHorizontal: 6,
    alignItems: 'center',
  },
  tileValue: { fontSize: 20, fontFamily: F.bold, letterSpacing: -0.5 },
  tileUnit: { fontSize: 11, fontFamily: F.medium, color: C.textDim, marginTop: 1 },
  tileLabel: { fontSize: 11, fontFamily: F.medium, color: C.textMute, marginTop: 3, textAlign: 'center' },
  card: {
    backgroundColor: C.card,
    borderRadius: 20,
    padding: 16,
    borderWidth: 1,
    borderColor: C.border,
    marginBottom: 12,
  },
  cardLabel: {
    fontSize: 12,
    fontFamily: F.semibold,
    color: C.textDim,
    letterSpacing: 0.8,
    textTransform: 'uppercase',
    marginBottom: 10,
  },
  battRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  battNum: { fontSize: 16, fontFamily: F.bold, minWidth: 44, textAlign: 'center' },
  battTrack: { flex: 1, height: 12, borderRadius: 6, backgroundColor: C.border, overflow: 'hidden' },
  battLeft: { position: 'absolute', left: 0, top: 0, bottom: 0, borderRadius: 6 },
  battUsed: { position: 'absolute', top: 0, bottom: 0, backgroundColor: C.amber + '55' },
  battCaption: { fontSize: 12, fontFamily: F.medium, color: C.textMute, textAlign: 'center', marginTop: 8 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 12 },
  detail: {
    width: '48.8%',
    flexGrow: 1,
    backgroundColor: C.card,
    borderRadius: 16,
    padding: 14,
    borderWidth: 1,
    borderColor: C.border,
  },
  detailTop: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  detailLabel: { fontSize: 12, fontFamily: F.medium, color: C.textDim },
  detailValue: { fontSize: 18, fontFamily: F.bold, color: C.text, marginTop: 6, letterSpacing: -0.3 },
  note: {
    flexDirection: 'row',
    gap: 8,
    backgroundColor: C.cardHi,
    borderRadius: 14,
    padding: 12,
    marginBottom: 12,
  },
  noteText: { flex: 1, fontSize: 12, fontFamily: F.regular, color: C.textDim, lineHeight: 17 },
  cmpRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 6 },
  cmpLabel: { fontSize: 14, fontFamily: F.medium, color: C.textDim },
  cmpValue: { fontSize: 14, fontFamily: F.bold, color: C.text },
  cmpNote: { fontSize: 12, fontFamily: F.regular, color: C.textMute, marginTop: 8, lineHeight: 17 },
  actions: { gap: 10, marginTop: 4 },
  primary: { backgroundColor: C.blue, borderRadius: 16, paddingVertical: 16, alignItems: 'center' },
  primaryText: { fontSize: 16, fontFamily: F.semibold, color: '#fff' },
  secondary: {
    backgroundColor: C.card,
    borderRadius: 16,
    paddingVertical: 15,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: C.border,
  },
  secondaryText: { fontSize: 15, fontFamily: F.semibold, color: C.text },
});
