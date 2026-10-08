import { useEffect, useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  Modal,
  Pressable,
  ScrollView,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { Zap } from 'lucide-react-native';
import { C, F, fmtMoney } from '@/constants/theme';
import { Chips } from '@/components/ui';
import { CHARGE_TYPES, saveCharge, type ChargeRecord, type ChargeType } from '@/utils/charges';

const num = (s: string) => parseFloat(s.replace(',', '.'));

export function ChargeSheet({
  visible,
  capacityKwh,
  currency,
  initialFrom,
  initialTo,
  onClose,
  onSaved,
}: {
  visible: boolean;
  capacityKwh: number;
  currency: string;
  initialFrom?: number | null;
  initialTo?: number | null;
  onClose: () => void;
  onSaved: (c: ChargeRecord) => void;
}) {
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [kwh, setKwh] = useState('');
  const [kwhTouched, setKwhTouched] = useState(false);
  const [cost, setCost] = useState('');
  const [mode, setMode] = useState<'total' | 'perKwh'>('total');
  const [type, setType] = useState<ChargeType>('home');
  const [place, setPlace] = useState('');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!visible) return;
    setFrom(initialFrom != null ? String(Math.round(initialFrom)) : '');
    setTo(initialTo != null ? String(Math.round(initialTo)) : '');
    setKwh('');
    setKwhTouched(false);
    setCost('');
    setMode('total');
    setPlace('');
    setError(null);
  }, [visible]);

  // kWh from the battery % unless the user typed the receipt value.
  const f = num(from);
  const t = num(to);
  const autoKwh = isFinite(f) && isFinite(t) && t > f ? (capacityKwh * (t - f)) / 100 : null;
  useEffect(() => {
    if (!kwhTouched) setKwh(autoKwh != null ? autoKwh.toFixed(1) : '');
  }, [from, to, kwhTouched]);

  const k = num(kwh);
  const c = num(cost);
  const total = isFinite(c) ? (mode === 'total' ? c : c * (isFinite(k) ? k : 0)) : NaN;
  const perKwh = isFinite(total) && isFinite(k) && k > 0 ? total / k : NaN;

  const save = async () => {
    setError(null);
    if (!(isFinite(f) && isFinite(t)) || f < 0 || t > 100 || t <= f) return setError('Enter battery % before and after (e.g. 24 → 80).');
    if (!(isFinite(k) && k > 0 && k < 250)) return setError('Check the kWh added.');
    if (!(isFinite(total) && total >= 0 && total < 1000)) return setError('Enter what you paid (0 if free).');
    const rec: ChargeRecord = {
      id: String(Date.now()),
      date: new Date().toISOString(),
      fromPct: f,
      toPct: t,
      kwh: Math.round(k * 10) / 10,
      cost: Math.round(total * 100) / 100,
      type,
      place: place.trim() || undefined,
    };
    await saveCharge(rec);
    onSaved(rec);
  };

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <Pressable style={s.overlay} onPress={onClose}>
          <Pressable style={s.sheet} onPress={(e) => e.stopPropagation()}>
            <ScrollView
              keyboardShouldPersistTaps="handled"
              showsVerticalScrollIndicator={false}
              contentContainerStyle={{ width: '100%' }}
              style={{ width: '100%' }}
            >
              <View style={s.head}>
                <Zap size={18} color={C.green} fill={C.green} />
                <Text style={s.title}>Add charge</Text>
              </View>

              <Text style={s.label}>Battery</Text>
              <View style={s.row}>
                <TextInput
                  style={[s.input, s.flex]}
                  value={from}
                  onChangeText={setFrom}
                  keyboardType="decimal-pad"
                  placeholder="from %"
                  placeholderTextColor={C.textMute}
                />
                <Text style={s.arrow}>→</Text>
                <TextInput
                  style={[s.input, s.flex]}
                  value={to}
                  onChangeText={setTo}
                  keyboardType="decimal-pad"
                  placeholder="to %"
                  placeholderTextColor={C.textMute}
                />
              </View>

              <Text style={s.label}>Energy added</Text>
              <View style={s.row}>
                <TextInput
                  style={[s.input, s.flex]}
                  value={kwh}
                  onChangeText={(v) => {
                    setKwh(v);
                    setKwhTouched(true);
                  }}
                  keyboardType="decimal-pad"
                  placeholder="kWh"
                  placeholderTextColor={C.textMute}
                />
                <Text style={s.unit}>kWh</Text>
              </View>
              <Text style={s.help}>
                {kwhTouched ? 'From your receipt.' : 'Calculated from your battery size — type the receipt value if you have it.'}
              </Text>

              <Text style={s.label}>Cost</Text>
              <View style={s.row}>
                <TextInput
                  style={[s.input, s.flex]}
                  value={cost}
                  onChangeText={setCost}
                  keyboardType="decimal-pad"
                  placeholder={mode === 'total' ? 'total paid' : 'price per kWh'}
                  placeholderTextColor={C.textMute}
                />
                <Text style={s.unit}>{mode === 'total' ? currency : `${currency}/kWh`}</Text>
              </View>
              <View style={{ height: 8 }} />
              <Chips
                options={[
                  { label: 'Total paid', value: 'total' as const },
                  { label: 'Price per kWh', value: 'perKwh' as const },
                ]}
                value={mode}
                onChange={setMode}
              />
              {isFinite(perKwh) && isFinite(total) && (
                <Text style={s.calc}>
                  {fmtMoney(total, currency)} · {fmtMoney(perKwh, currency)}/kWh
                </Text>
              )}

              <Text style={s.label}>Where</Text>
              <Chips options={CHARGE_TYPES.map((x) => ({ label: x.label, value: x.key }))} value={type} onChange={setType} />
              <TextInput
                style={[s.input, { marginTop: 10 }]}
                value={place}
                onChangeText={setPlace}
                placeholder="Place (optional), e.g. Ionity Postojna"
                placeholderTextColor={C.textMute}
              />

              {error && <Text style={s.error}>{error}</Text>}

              <TouchableOpacity style={s.save} onPress={save} activeOpacity={0.85}>
                <Text style={s.saveText}>Save charge</Text>
              </TouchableOpacity>
              <TouchableOpacity style={s.cancel} onPress={onClose} activeOpacity={0.7}>
                <Text style={s.cancelText}>Cancel</Text>
              </TouchableOpacity>
            </ScrollView>
          </Pressable>
        </Pressable>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const s = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'center', alignItems: 'center', padding: 16 },
  sheet: {
    width: '100%',
    maxWidth: 420,
    maxHeight: '92%',
    backgroundColor: C.card,
    borderRadius: 24,
    padding: 22,
    borderWidth: 1,
    borderColor: C.borderHi,
  },
  head: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 6 },
  title: { fontSize: 20, fontFamily: F.bold, color: C.text },
  label: {
    fontSize: 12,
    fontFamily: F.semibold,
    color: C.textDim,
    textTransform: 'uppercase',
    letterSpacing: 0.8,
    marginTop: 16,
    marginBottom: 8,
  },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  flex: { flex: 1, minWidth: 0, flexBasis: 0 },
  input: {
    minWidth: 0,
    height: 50,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: C.borderHi,
    backgroundColor: C.bg,
    paddingHorizontal: 14,
    fontSize: 16,
    fontFamily: F.medium,
    color: C.text,
  },
  arrow: { color: C.textDim, fontSize: 18, fontFamily: F.semibold },
  unit: { color: C.textDim, fontFamily: F.semibold, fontSize: 14, minWidth: 44 },
  help: { color: C.textMute, fontFamily: F.regular, fontSize: 11.5, marginTop: 6 },
  calc: { color: C.green, fontFamily: F.semibold, fontSize: 13, marginTop: 8 },
  error: { color: C.red, fontFamily: F.medium, fontSize: 13, marginTop: 14, textAlign: 'center' },
  save: { backgroundColor: C.green, borderRadius: 14, paddingVertical: 15, alignItems: 'center', marginTop: 20 },
  saveText: { color: '#06240F', fontFamily: F.bold, fontSize: 16 },
  cancel: { paddingVertical: 12, alignItems: 'center' },
  cancelText: { color: C.textDim, fontFamily: F.medium, fontSize: 15 },
});
