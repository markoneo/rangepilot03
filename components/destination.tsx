import { useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  Modal,
  ScrollView,
  ActivityIndicator,
  Platform,
  KeyboardAvoidingView,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { MapPin, Search, X, Clock, Mountain, RotateCcw, Gauge, CheckCircle2, AlertTriangle, XCircle } from 'lucide-react-native';
import { C, F } from '@/constants/theme';
import {
  searchPlaces,
  resolvePlace,
  loadRecentPlaces,
  rememberPlace,
  newSessionToken,
  usingGoogle,
  type Place,
  type PlaceSuggestion,
  type ArrivalEstimate,
} from '@/utils/maps';

export function DestinationSheet({
  visible,
  near,
  onClose,
  onPick,
}: {
  visible: boolean;
  near: { lat: number; lon: number } | null;
  onClose: () => void;
  onPick: (p: Place) => void;
}) {
  const insets = useSafeAreaInsets();
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<PlaceSuggestion[]>([]);
  const [recent, setRecent] = useState<Place[]>([]);
  const [loading, setLoading] = useState(false);
  const [resolving, setResolving] = useState<string | null>(null);
  const token = useRef(newSessionToken());
  const seq = useRef(0);

  useEffect(() => {
    if (!visible) return;
    setQuery('');
    setResults([]);
    token.current = newSessionToken();
    loadRecentPlaces().then(setRecent);
  }, [visible]);

  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) {
      setResults([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    const my = ++seq.current;
    const t = setTimeout(async () => {
      const r = await searchPlaces(q, near, token.current);
      if (my === seq.current) {
        setResults(r);
        setLoading(false);
      }
    }, 250);
    return () => clearTimeout(t);
  }, [query]);

  const pickSuggestion = async (s: PlaceSuggestion) => {
    setResolving(s.id);
    const p = await resolvePlace(s, token.current);
    setResolving(null);
    if (!p) return;
    token.current = newSessionToken();
    rememberPlace(p);
    onPick(p);
  };

  const pickRecent = (p: Place) => {
    rememberPlace(p);
    onPick(p);
  };

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <KeyboardAvoidingView
        style={[s.root, { paddingTop: insets.top + 8 }]}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <View style={s.head}>
          <Text style={s.title}>Where to?</Text>
          <TouchableOpacity onPress={onClose} hitSlop={12} style={s.close}>
            <X size={22} color={C.textDim} />
          </TouchableOpacity>
        </View>
        <View style={s.inputWrap}>
          <Search size={18} color={C.textMute} />
          <TextInput
            style={s.input}
            value={query}
            onChangeText={setQuery}
            placeholder="Address, airport, hotel…"
            placeholderTextColor={C.textMute}
            autoFocus
            autoCorrect={false}
            returnKeyType="search"
          />
          {loading && <ActivityIndicator size="small" color={C.blue} />}
          {!loading && query.length > 0 && (
            <TouchableOpacity onPress={() => setQuery('')} hitSlop={10}>
              <X size={16} color={C.textMute} />
            </TouchableOpacity>
          )}
        </View>

        <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ paddingBottom: insets.bottom + 24 }}>
          {query.trim().length < 2 && recent.length > 0 && (
            <>
              <Text style={s.section}>Recent</Text>
              {recent.map((p, i) => (
                <TouchableOpacity key={`r${i}`} style={s.row} onPress={() => pickRecent(p)} activeOpacity={0.7}>
                  <Clock size={18} color={C.textDim} />
                  <View style={{ flex: 1 }}>
                    <Text style={s.rowTitle} numberOfLines={1}>
                      {p.name}
                    </Text>
                    <Text style={s.rowSub} numberOfLines={1}>
                      {p.address}
                    </Text>
                  </View>
                </TouchableOpacity>
              ))}
            </>
          )}
          {results.map((r) => (
            <TouchableOpacity key={r.id} style={s.row} onPress={() => pickSuggestion(r)} activeOpacity={0.7}>
              <MapPin size={18} color={C.blue} />
              <View style={{ flex: 1 }}>
                <Text style={s.rowTitle} numberOfLines={1}>
                  {r.title}
                </Text>
                {r.subtitle ? (
                  <Text style={s.rowSub} numberOfLines={1}>
                    {r.subtitle}
                  </Text>
                ) : null}
              </View>
              {resolving === r.id && <ActivityIndicator size="small" color={C.blue} />}
            </TouchableOpacity>
          ))}
          {!loading && query.trim().length >= 2 && results.length === 0 && (
            <Text style={s.empty}>No places found</Text>
          )}
          <Text style={s.attrib}>{usingGoogle() ? 'Powered by Google' : 'Search © OpenStreetMap contributors'}</Text>
        </ScrollView>
      </KeyboardAvoidingView>
    </Modal>
  );
}

export function ArrivalCard({
  place,
  km,
  minutes,
  climbM,
  descentM,
  estimate,
  reservePct,
  loading,
  onChange,
  onClear,
  footer,
}: {
  place: { name: string; address?: string };
  km: number | null;
  minutes: number | null;
  climbM: number | null;
  descentM: number | null;
  estimate: ArrivalEstimate | null;
  reservePct: number;
  loading?: boolean;
  onChange?: () => void;
  onClear?: () => void;
  footer?: React.ReactNode;
}) {
  const st = estimate?.status;
  const col = st === 'ok' ? C.green : st === 'tight' ? C.amber : st === 'no' ? C.red : C.textDim;
  const bg = st === 'ok' ? C.greenDim : st === 'tight' ? C.amberDim : st === 'no' ? C.redDim : C.card;
  const Icon = st === 'ok' ? CheckCircle2 : st === 'tight' ? AlertTriangle : XCircle;
  const headline =
    st === 'ok' ? 'You’ll make it' : st === 'tight' ? 'Tight — drive gently' : st === 'no' ? 'Charge on the way' : '';
  const fmtMin = (m: number) => (m >= 60 ? `${Math.floor(m / 60)} h ${Math.round(m % 60)} min` : `${Math.round(m)} min`);

  return (
    <View style={[s.card, { backgroundColor: bg, borderColor: col + '55' }]}>
      <View style={s.cardHead}>
        <MapPin size={16} color={col} />
        <TouchableOpacity style={{ flex: 1 }} onPress={onChange} disabled={!onChange} activeOpacity={0.7}>
          <Text style={s.placeName} numberOfLines={1}>
            {place.name}
          </Text>
          {place.address ? (
            <Text style={s.placeAddr} numberOfLines={1}>
              {place.address}
            </Text>
          ) : null}
        </TouchableOpacity>
        {onClear && (
          <TouchableOpacity onPress={onClear} hitSlop={10}>
            <X size={18} color={C.textMute} />
          </TouchableOpacity>
        )}
      </View>

      {loading || !estimate || km == null ? (
        <View style={s.loadingRow}>
          <ActivityIndicator color={C.blue} />
          <Text style={s.loadingText}>Calculating route…</Text>
        </View>
      ) : (
        <>
          <View style={s.verdict}>
            <Icon size={22} color={col} />
            <Text style={[s.verdictText, { color: col }]}>{headline}</Text>
          </View>
          <Text style={s.arrival}>
            Arrive with{' '}
            <Text style={[s.arrivalPct, { color: col }]}>{Math.max(-99, Math.round(estimate.arrivalPct))}%</Text>
          </Text>
          <Text style={s.arrivalSub}>
            {km.toFixed(0)} km{minutes != null ? ` · ${fmtMin(minutes)}` : ''} · uses {estimate.needKwh.toFixed(1)} kWh
            {estimate.arrivalPct > 0 ? ` · ${Math.round(estimate.rangeAtArrivalKm)} km range left` : ''}
          </Text>

          <View style={s.facts}>
            {climbM != null && descentM != null && (climbM > 30 || descentM > 30) && (
              <Fact icon={<Mountain size={14} color={C.textDim} />} text={`↑${climbM} m ↓${descentM} m`} />
            )}
            <Fact
              icon={<RotateCcw size={14} color={C.textDim} />}
              text={
                estimate.roundTripPct >= reservePct
                  ? `Return without charging: ${Math.round(estimate.roundTripPct)}%`
                  : 'Return needs a charge'
              }
            />
            {st !== 'ok' && estimate.maxConsumption != null && estimate.maxConsumption >= 8 && (
              <Fact
                icon={<Gauge size={14} color={C.textDim} />}
                text={`Keep under ${estimate.maxConsumption.toFixed(1)} kWh/100 to arrive with ${reservePct}%`}
              />
            )}
          </View>
        </>
      )}
      {footer}
    </View>
  );
}

function Fact({ icon, text }: { icon: React.ReactNode; text: string }) {
  return (
    <View style={s.fact}>
      {icon}
      <Text style={s.factText}>{text}</Text>
    </View>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: C.bg, paddingHorizontal: 16 },
  head: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 },
  title: { fontSize: 22, fontFamily: F.bold, color: C.text },
  close: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  inputWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: C.card,
    borderRadius: 14,
    borderWidth: 1.5,
    borderColor: C.blue,
    paddingHorizontal: 14,
    height: 54,
    marginBottom: 8,
  },
  input: { flex: 1, fontSize: 16, fontFamily: F.medium, color: C.text, height: '100%' },
  section: {
    fontSize: 12,
    fontFamily: F.semibold,
    color: C.textDim,
    textTransform: 'uppercase',
    letterSpacing: 0.8,
    marginTop: 14,
    marginBottom: 4,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: C.border,
  },
  rowTitle: { fontSize: 15, fontFamily: F.semibold, color: C.text },
  rowSub: { fontSize: 12.5, fontFamily: F.regular, color: C.textDim, marginTop: 2 },
  empty: { color: C.textDim, fontFamily: F.medium, textAlign: 'center', marginTop: 30 },
  attrib: { color: C.textMute, fontFamily: F.regular, fontSize: 11, textAlign: 'right', marginTop: 14 },
  card: { borderRadius: 20, borderWidth: 1, padding: 16, marginBottom: 12 },
  cardHead: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  placeName: { fontSize: 15, fontFamily: F.semibold, color: C.text },
  placeAddr: { fontSize: 12, fontFamily: F.regular, color: C.textDim, marginTop: 1 },
  loadingRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 16 },
  loadingText: { color: C.textDim, fontFamily: F.medium, fontSize: 13 },
  verdict: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 14 },
  verdictText: { fontSize: 16, fontFamily: F.bold },
  arrival: { fontSize: 22, fontFamily: F.semibold, color: C.text, marginTop: 6 },
  arrivalPct: { fontSize: 34, fontFamily: F.bold },
  arrivalSub: { fontSize: 12.5, fontFamily: F.medium, color: C.textDim, marginTop: 2 },
  facts: { marginTop: 12, gap: 6 },
  fact: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  factText: { fontSize: 13, fontFamily: F.medium, color: C.text },
});
