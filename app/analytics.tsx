import { useState, useMemo, useCallback } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, ScrollView, LayoutChangeEvent } from 'react-native';
import { useRouter, useFocusEffect } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Path, Line, Circle, Rect, G, Text as SvgText } from 'react-native-svg';
import { ArrowLeft, Activity, Thermometer, Gauge, Route, Award, TrendingUp } from 'lucide-react-native';
import {
  loadTrips,
  loadPrefs,
  TripRecord,
  UserPrefs,
  DEFAULT_PREFS,
  tripEnergyKwh,
  tripConsumption,
} from '@/utils/storage';
import { C, F, fmtMoney } from '@/constants/theme';
import { Chips } from '@/components/ui';
import { buildProfile, STYLES, SEASONS } from '@/utils/learnedProfile';

type Period = '7' | '30' | '90' | 'all';

type M = {
  trip: TripRecord;
  t: number;
  cons: number;
  km: number;
  kwh: number;
  avgSpeed: number;
  temp: number | null;
};

function toM(t: TripRecord): M | null {
  const cons = tripConsumption(t);
  if (!cons || t.distanceKm <= 0.2) return null;
  const secs = t.movingSeconds && t.movingSeconds > 60 ? t.movingSeconds : t.durationSeconds;
  return {
    trip: t,
    t: new Date(t.startedAt).getTime(),
    cons,
    km: t.distanceKm,
    kwh: tripEnergyKwh(t) || (cons * t.distanceKm) / 100,
    avgSpeed: secs > 0 ? t.distanceKm / (secs / 3600) : 0,
    temp:
      t.minTemperatureC != null && t.maxTemperatureC != null
        ? (t.minTemperatureC + t.maxTemperatureC) / 2
        : t.maxTemperatureC ?? null,
  };
}

/** Distance-weighted consumption (a 2 km trip shouldn't count like a 200 km one). */
function wCons(ms: M[]): number {
  const km = ms.reduce((s, m) => s + m.km, 0);
  return km > 0 ? ms.reduce((s, m) => s + m.cons * m.km, 0) / km : 0;
}

export default function AnalyticsScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [trips, setTrips] = useState<TripRecord[]>([]);
  const [prefs, setPrefs] = useState<UserPrefs>(DEFAULT_PREFS);
  const [loading, setLoading] = useState(true);
  const [period, setPeriod] = useState<Period>('30');

  useFocusEffect(
    useCallback(() => {
      let alive = true;
      (async () => {
        const [data, p] = await Promise.all([loadTrips(), loadPrefs()]);
        if (!alive) return;
        setTrips(data);
        setPrefs(p);
        setLoading(false);
      })();
      return () => {
        alive = false;
      };
    }, [])
  );

  const all = useMemo(() => trips.map(toM).filter((m): m is M => m !== null), [trips]);
  const ms = useMemo(() => {
    if (period === 'all') return all;
    const since = Date.now() - Number(period) * 86400000;
    return all.filter((m) => m.t >= since);
  }, [all, period]);

  const stats = useMemo(() => {
    if (ms.length === 0) return null;
    const km = ms.reduce((s, m) => s + m.km, 0);
    const kwh = ms.reduce((s, m) => s + m.kwh, 0);
    const secs = ms.reduce((s, m) => s + m.trip.durationSeconds, 0);
    const cons = wCons(ms);
    const longest = ms.reduce((a, b) => (b.km > a.km ? b : a));
    const eligible = ms.filter((m) => m.km >= 5);
    const best = (eligible.length ? eligible : ms).reduce((a, b) => (b.cons < a.cons ? b : a));
    const priced = ms.filter((m) => m.trip.pricePerKwh != null || prefs.electricityPrice != null);
    const cost =
      priced.length > 0
        ? priced.reduce((s, m) => s + m.kwh * (m.trip.pricePerKwh ?? prefs.electricityPrice ?? 0), 0)
        : null;
    return { km, kwh, secs, cons, longest, best, cost };
  }, [ms, prefs]);

  const bars = useMemo(() => buildBars(ms, period), [ms, period]);
  const trend = useMemo(() => [...ms].sort((a, b) => a.t - b.t), [ms]);

  const breakdowns = useMemo(() => {
    const pick = (f: (m: M) => boolean) => ms.filter(f);
    return [
      {
        icon: <Thermometer size={15} color="#60A5FA" />,
        title: 'Temperature',
        a: { label: 'Below 10°C', ms: pick((m) => m.temp != null && m.temp < 10) },
        b: { label: 'Above 20°C', ms: pick((m) => m.temp != null && m.temp > 20) },
      },
      {
        icon: <Gauge size={15} color={C.amber} />,
        title: 'Speed',
        a: { label: 'Under 60 km/h', ms: pick((m) => m.avgSpeed > 0 && m.avgSpeed < 60) },
        b: { label: 'Over 90 km/h', ms: pick((m) => m.avgSpeed > 90) },
      },
      {
        icon: <Route size={15} color={C.green} />,
        title: 'Trip length',
        a: { label: 'Under 20 km', ms: pick((m) => m.km < 20) },
        b: { label: 'Over 50 km', ms: pick((m) => m.km > 50) },
      },
    ];
  }, [ms]);

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <TouchableOpacity style={styles.back} onPress={() => router.back()} activeOpacity={0.7}>
          <ArrowLeft size={22} color={C.textDim} />
        </TouchableOpacity>
        <Text style={styles.title}>Statistics</Text>
        <View style={styles.back} />
      </View>

      {loading ? (
        <View style={styles.empty}>
          <Text style={styles.emptyBody}>Loading…</Text>
        </View>
      ) : all.length === 0 ? (
        <View style={styles.empty}>
          <Activity size={36} color={C.textMute} strokeWidth={1.5} />
          <Text style={styles.emptyTitle}>No trips yet</Text>
          <Text style={styles.emptyBody}>Finish your first drive and your statistics will appear here.</Text>
        </View>
      ) : (
        <ScrollView
          contentContainerStyle={[styles.scroll, { paddingBottom: insets.bottom + 32 }]}
          showsVerticalScrollIndicator={false}
        >
          <Chips
            options={[
              { label: '7 days', value: '7' as Period },
              { label: '30 days', value: '30' as Period },
              { label: '90 days', value: '90' as Period },
              { label: 'All', value: 'all' as Period },
            ]}
            value={period}
            onChange={setPeriod}
          />

          {!stats ? (
            <Text style={[styles.emptyBody, { marginTop: 40 }]}>No trips in this period.</Text>
          ) : (
            <>
              <View style={styles.kpis}>
                <Kpi value={stats.km.toFixed(0)} unit="km" label="Distance" />
                <Kpi value={String(ms.length)} label={ms.length === 1 ? 'Trip' : 'Trips'} />
                <Kpi value={stats.cons.toFixed(1)} unit="kWh/100" label="Avg consumption" color={C.amber} />
                <Kpi value={stats.kwh.toFixed(1)} unit="kWh" label="Energy" />
                <Kpi value={fmtHours(stats.secs)} label="Driving time" />
                {stats.cost != null ? (
                  <Kpi value={fmtMoney(stats.cost, prefs.currency)} label="Charging cost" color={C.green} />
                ) : (
                  <Kpi
                    value={stats.km > 0 ? ((stats.kwh / stats.km) * 1000).toFixed(0) : '–'}
                    unit="Wh/km"
                    label="Efficiency"
                  />
                )}
              </View>
              {stats.cost != null && stats.km > 0 && (
                <Text style={styles.subNote}>
                  ≈ {fmtMoney((stats.cost / stats.km) * 100, prefs.currency)} per 100 km
                </Text>
              )}

              <Text style={styles.section}>Distance</Text>
              <View style={styles.card}>
                <BarChart bars={bars} />
              </View>

              {trend.length >= 2 && (
                <>
                  <Text style={styles.section}>Consumption per trip</Text>
                  <View style={styles.card}>
                    <TrendChart points={trend} average={stats.cons} />
                  </View>
                </>
              )}

              <View style={styles.highlights}>
                <Highlight
                  icon={<Award size={15} color={C.green} />}
                  label="Most efficient"
                  primary={`${stats.best.cons.toFixed(1)} kWh/100`}
                  secondary={`${stats.best.km.toFixed(1)} km · ${fmtDate(stats.best.t)}`}
                  onPress={() => router.push({ pathname: '/trip-summary', params: { tripId: stats.best.trip.id } })}
                />
                <Highlight
                  icon={<TrendingUp size={15} color={C.blue} />}
                  label="Longest trip"
                  primary={`${stats.longest.km.toFixed(1)} km`}
                  secondary={`${stats.longest.cons.toFixed(1)} kWh/100 · ${fmtDate(stats.longest.t)}`}
                  onPress={() =>
                    router.push({ pathname: '/trip-summary', params: { tripId: stats.longest.trip.id } })
                  }
                />
              </View>

              <Text style={styles.section}>Your real consumption</Text>
              <ProfileTable trips={trips} />

              <Text style={styles.section}>What affects your consumption</Text>
              {breakdowns.map((b) => (
                <Breakdown key={b.title} {...b} />
              ))}
              <Text style={styles.footer}>
                Averages are weighted by distance and use real consumption (from the battery % you
                enter at the end) when available.
              </Text>
            </>
          )}
        </ScrollView>
      )}
    </View>
  );
}

function ProfileTable({ trips }: { trips: TripRecord[] }) {
  const p = useMemo(() => buildProfile(trips), [trips]);
  const any = STYLES.some((s) => SEASONS.some((se) => p[s.key][se.key]));
  return (
    <View style={styles.card}>
      <View style={styles.ptRow}>
        <View style={styles.ptHeadCell} />
        {SEASONS.map((se) => (
          <View key={se.key} style={[styles.ptHeadCell, { alignItems: 'center' }]}>
            <Text style={styles.ptHead}>{se.label}</Text>
            <Text style={styles.ptHint}>{se.hint}</Text>
          </View>
        ))}
      </View>
      {STYLES.map((s) => (
        <View key={s.key} style={[styles.ptRow, styles.ptBody]}>
          <View style={styles.ptHeadCell}>
            <Text style={styles.ptHead}>{s.label}</Text>
            <Text style={styles.ptHint}>{s.hint}</Text>
          </View>
          {SEASONS.map((se) => {
            const c = p[s.key][se.key];
            return (
              <View key={se.key} style={styles.ptCell}>
                <Text style={[styles.ptValue, !c && { color: C.textMute }]}>{c ? c.consumption.toFixed(1) : '—'}</Text>
                <Text style={styles.ptHint}>{c ? `${c.trips} ${c.trips === 1 ? 'trip' : 'trips'}` : 'no data'}</Text>
              </View>
            );
          })}
        </View>
      ))}
      <Text style={styles.ptNote}>
        {any
          ? 'kWh/100 km from your trips (battery % at start and end). Your City / Mixed / Highway presets use these values for today’s weather.'
          : 'Fills in as you finish trips of 10 km or more and enter the battery % at the end.'}
      </Text>
    </View>
  );
}

function fmtHours(secs: number) {
  const h = Math.floor(secs / 3600);
  const m = Math.round((secs % 3600) / 60);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}
function fmtDate(t: number) {
  return new Date(t).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
}

type Bar = { label: string; km: number };
function buildBars(ms: M[], period: Period): Bar[] {
  const day = 86400000;
  const startOfDay = (t: number) => {
    const d = new Date(t);
    d.setHours(0, 0, 0, 0);
    return d.getTime();
  };
  if (period === '7') {
    const today = startOfDay(Date.now());
    return Array.from({ length: 7 }, (_, i) => {
      const from = today - (6 - i) * day;
      const km = ms.filter((m) => m.t >= from && m.t < from + day).reduce((s, m) => s + m.km, 0);
      return { label: new Date(from).toLocaleDateString(undefined, { weekday: 'narrow' }), km };
    });
  }
  // weekly buckets (Mon-based)
  const weeks = period === '30' ? 5 : period === '90' ? 13 : 12;
  const now = new Date();
  const dow = (now.getDay() + 6) % 7;
  const thisMonday = startOfDay(Date.now()) - dow * day;
  return Array.from({ length: weeks }, (_, i) => {
    const from = thisMonday - (weeks - 1 - i) * 7 * day;
    const km = ms.filter((m) => m.t >= from && m.t < from + 7 * day).reduce((s, m) => s + m.km, 0);
    const d = new Date(from);
    return { label: `${d.getDate()}.${d.getMonth() + 1}`, km };
  });
}

function BarChart({ bars }: { bars: Bar[] }) {
  const [width, setWidth] = useState(0);
  const height = 150;
  const padB = 20;
  const padT = 16;
  const onLayout = (e: LayoutChangeEvent) => setWidth(e.nativeEvent.layout.width);
  if (width === 0) return <View style={{ height }} onLayout={onLayout} />;
  const max = Math.max(1, ...bars.map((b) => b.km));
  const slot = width / bars.length;
  const bw = Math.min(28, slot * 0.6);
  const innerH = height - padB - padT;
  const showEvery = bars.length > 8 ? 2 : 1;
  return (
    <View style={{ height }} onLayout={onLayout}>
      <Svg width={width} height={height}>
        {bars.map((b, i) => {
          const h = b.km > 0 ? Math.max(3, (b.km / max) * innerH) : 2;
          const x = i * slot + (slot - bw) / 2;
          const y = padT + innerH - h;
          const isLast = i === bars.length - 1;
          return (
            <G key={i}>
              <Rect x={x} y={y} width={bw} height={h} rx={5} fill={b.km > 0 ? (isLast ? C.blue : '#2C4A7A') : C.border} />
              {b.km > 0 && b.km === max && (
                <SvgText x={x + bw / 2} y={y - 4} fontSize="10" fill={C.textDim} textAnchor="middle">
                  {Math.round(b.km)}
                </SvgText>
              )}
              {(i % showEvery === 0 || isLast) && (
                <SvgText x={x + bw / 2} y={height - 5} fontSize="10" fill={C.textMute} textAnchor="middle">
                  {b.label}
                </SvgText>
              )}
            </G>
          );
        })}
      </Svg>
    </View>
  );
}

function TrendChart({ points, average }: { points: M[]; average: number }) {
  const [width, setWidth] = useState(0);
  const height = 170;
  const padL = 30;
  const padR = 10;
  const padT = 12;
  const padB = 14;
  const onLayout = (e: LayoutChangeEvent) => setWidth(e.nativeEvent.layout.width);
  if (points.length < 2 || width === 0) return <View style={{ height }} onLayout={onLayout} />;
  const innerW = width - padL - padR;
  const innerH = height - padT - padB;
  const values = points.map((p) => p.cons);
  const rawMin = Math.min(...values, average);
  const rawMax = Math.max(...values, average);
  const pad = Math.max(1, (rawMax - rawMin) * 0.15);
  const yMin = Math.max(0, Math.floor(rawMin - pad));
  const yMax = Math.ceil(rawMax + pad);
  const ySpan = Math.max(1, yMax - yMin);
  const xAt = (i: number) => padL + (i / Math.max(1, points.length - 1)) * innerW;
  const yAt = (v: number) => padT + innerH - ((v - yMin) / ySpan) * innerH;
  let d = `M ${xAt(0)} ${yAt(points[0].cons)}`;
  for (let i = 1; i < points.length; i++) d += ` L ${xAt(i)} ${yAt(points[i].cons)}`;
  const yTicks = [yMin, (yMin + yMax) / 2, yMax];
  const avgY = yAt(average);
  return (
    <View style={{ height }} onLayout={onLayout}>
      <Svg width={width} height={height}>
        {yTicks.map((v) => (
          <Line key={`g${v}`} x1={padL} x2={width - padR} y1={yAt(v)} y2={yAt(v)} stroke={C.border} strokeWidth={1} />
        ))}
        {yTicks.map((v) => (
          <SvgText key={`y${v}`} x={padL - 6} y={yAt(v) + 3} fontSize="10" fill={C.textMute} textAnchor="end">
            {v.toFixed(0)}
          </SvgText>
        ))}
        <Line x1={padL} x2={width - padR} y1={avgY} y2={avgY} stroke={C.amber} strokeWidth={1} strokeDasharray="4 4" />
        <SvgText x={width - padR - 2} y={avgY - 4} fontSize="10" fill={C.amber} textAnchor="end">
          avg {average.toFixed(1)}
        </SvgText>
        <Path d={d} stroke={C.blue} strokeWidth={2} fill="none" />
        {points.map((p, i) => (
          <Circle key={i} cx={xAt(i)} cy={yAt(p.cons)} r={points.length > 40 ? 1.5 : 3} fill={C.blue} />
        ))}
      </Svg>
    </View>
  );
}

function Kpi({ value, unit, label, color = C.text }: { value: string; unit?: string; label: string; color?: string }) {
  return (
    <View style={styles.kpi}>
      <View style={styles.valRow}>
        <Text style={[styles.kpiValue, { color }]} numberOfLines={1}>
          {value}
        </Text>
        {unit ? <Text style={styles.kpiUnit}>{unit}</Text> : null}
      </View>
      <Text style={styles.kpiLabel}>{label}</Text>
    </View>
  );
}

function Highlight({
  icon,
  label,
  primary,
  secondary,
  onPress,
}: {
  icon: React.ReactNode;
  label: string;
  primary: string;
  secondary: string;
  onPress: () => void;
}) {
  return (
    <TouchableOpacity style={styles.hl} onPress={onPress} activeOpacity={0.8}>
      <View style={styles.hlTop}>
        {icon}
        <Text style={styles.hlLabel}>{label}</Text>
      </View>
      <Text style={styles.hlPrimary}>{primary}</Text>
      <Text style={styles.hlSecondary} numberOfLines={1}>
        {secondary}
      </Text>
    </TouchableOpacity>
  );
}

function Breakdown({
  icon,
  title,
  a,
  b,
}: {
  icon: React.ReactNode;
  title: string;
  a: { label: string; ms: M[] };
  b: { label: string; ms: M[] };
}) {
  const ca = wCons(a.ms);
  const cb = wCons(b.ms);
  let note: string | null = null;
  if (a.ms.length && b.ms.length && cb > 0) {
    const pct = ((ca - cb) / cb) * 100;
    note =
      Math.abs(pct) < 3
        ? 'About the same either way.'
        : `${a.label}: ${pct > 0 ? '+' : ''}${pct.toFixed(0)}% compared to ${b.label.toLowerCase()}.`;
  } else {
    note = 'Not enough trips in both groups yet.';
  }
  return (
    <View style={styles.card}>
      <View style={styles.bdHead}>
        {icon}
        <Text style={styles.bdTitle}>{title}</Text>
      </View>
      <View style={styles.bdBody}>
        {[{ ...a, c: ca }, { ...b, c: cb }].map((g, i) => (
          <View key={i} style={[styles.bdHalf, i === 1 && styles.bdRight]}>
            <Text style={styles.bdLabel}>{g.label}</Text>
            <Text style={styles.bdValue}>{g.ms.length ? g.c.toFixed(1) : '—'}</Text>
            <Text style={styles.bdUnit}>{g.ms.length ? `kWh/100 · ${g.ms.length} trips` : 'no data'}</Text>
          </View>
        ))}
      </View>
      <Text style={styles.bdNote}>{note}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: C.bg },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 8, paddingVertical: 6 },
  back: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  title: { fontSize: 18, fontFamily: F.bold, color: C.text },
  scroll: { paddingHorizontal: 16, paddingTop: 4 },
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32, gap: 10 },
  emptyTitle: { fontSize: 18, fontFamily: F.bold, color: C.text },
  emptyBody: { fontSize: 14, fontFamily: F.regular, color: C.textDim, textAlign: 'center', lineHeight: 20 },
  kpis: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 14 },
  kpi: {
    width: '31.5%',
    flexGrow: 1,
    backgroundColor: C.card,
    borderRadius: 16,
    paddingVertical: 14,
    paddingHorizontal: 10,
    borderWidth: 1,
    borderColor: C.border,
  },
  kpiValue: { fontSize: 20, fontFamily: F.bold, letterSpacing: -0.5 },
  kpiUnit: { fontSize: 11, fontFamily: F.medium, color: C.textDim },
  valRow: { flexDirection: 'row', alignItems: 'baseline', flexWrap: 'wrap', columnGap: 4 },
  kpiLabel: { fontSize: 11, fontFamily: F.medium, color: C.textMute, marginTop: 4 },
  subNote: { fontSize: 12, fontFamily: F.medium, color: C.textMute, marginTop: 8, textAlign: 'right' },
  section: {
    fontSize: 12,
    fontFamily: F.semibold,
    color: C.textDim,
    letterSpacing: 0.8,
    textTransform: 'uppercase',
    marginTop: 20,
    marginBottom: 10,
  },
  card: {
    backgroundColor: C.card,
    borderRadius: 18,
    padding: 14,
    borderWidth: 1,
    borderColor: C.border,
    marginBottom: 10,
  },
  highlights: { flexDirection: 'row', gap: 8, marginTop: 10 },
  hl: { flex: 1, backgroundColor: C.card, borderRadius: 16, padding: 14, borderWidth: 1, borderColor: C.border },
  hlTop: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  hlLabel: { fontSize: 12, fontFamily: F.medium, color: C.textDim },
  hlPrimary: { fontSize: 18, fontFamily: F.bold, color: C.text, marginTop: 8 },
  hlSecondary: { fontSize: 11.5, fontFamily: F.regular, color: C.textMute, marginTop: 3 },
  bdHead: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 10 },
  bdTitle: { fontSize: 14, fontFamily: F.semibold, color: C.text },
  bdBody: { flexDirection: 'row' },
  bdHalf: { flex: 1 },
  bdRight: { borderLeftWidth: 1, borderLeftColor: C.border, paddingLeft: 14 },
  bdLabel: { fontSize: 12, fontFamily: F.medium, color: C.textDim },
  bdValue: { fontSize: 22, fontFamily: F.bold, color: C.text, marginTop: 4 },
  bdUnit: { fontSize: 11, fontFamily: F.regular, color: C.textMute, marginTop: 2 },
  bdNote: { fontSize: 12, fontFamily: F.medium, color: C.textDim, marginTop: 10 },
  ptRow: { flexDirection: 'row', alignItems: 'center' },
  ptBody: { borderTopWidth: 1, borderTopColor: C.border, paddingVertical: 10 },
  ptHeadCell: { flex: 1, paddingVertical: 4 },
  ptCell: { flex: 1, alignItems: 'center' },
  ptHead: { fontSize: 13, fontFamily: F.semibold, color: C.text },
  ptHint: { fontSize: 10.5, fontFamily: F.regular, color: C.textMute, marginTop: 1 },
  ptValue: { fontSize: 18, fontFamily: F.bold, color: C.text },
  ptNote: { fontSize: 11.5, fontFamily: F.regular, color: C.textMute, marginTop: 8, lineHeight: 16 },
  footer: { fontSize: 11.5, fontFamily: F.regular, color: C.textMute, marginTop: 8, lineHeight: 17 },
});
