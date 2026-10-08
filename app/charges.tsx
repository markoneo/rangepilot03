import { useCallback, useMemo, useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, FlatList, Platform, Alert } from 'react-native';
import { useRouter, useFocusEffect } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ArrowLeft, Plus, Zap, Trash2, Home as HomeIcon, PlugZap, BatteryCharging } from 'lucide-react-native';
import { C, F, fmtMoney } from '@/constants/theme';
import { ChargeSheet } from '@/components/ChargeSheet';
import {
  averagePrice,
  deleteCharge,
  loadCharges,
  pricePerKwh,
  CHARGE_TYPES,
  type ChargeRecord,
} from '@/utils/charges';
import { loadCarSettings, loadPrefs, DEFAULT_PREFS, type UserPrefs } from '@/utils/storage';

export default function ChargesScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [charges, setCharges] = useState<ChargeRecord[]>([]);
  const [prefs, setPrefs] = useState<UserPrefs>(DEFAULT_PREFS);
  const [capacity, setCapacity] = useState(60);
  const [sheet, setSheet] = useState(false);

  const reload = useCallback(async () => {
    setCharges(await loadCharges());
    setPrefs(await loadPrefs());
    const car = await loadCarSettings();
    if (car) setCapacity(car.batteryCapacity);
  }, []);

  useFocusEffect(
    useCallback(() => {
      reload();
    }, [reload])
  );

  const month = useMemo(() => {
    const now = new Date();
    const m = charges.filter((c) => {
      const d = new Date(c.date);
      return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear();
    });
    return {
      cost: m.reduce((s, c) => s + c.cost, 0),
      kwh: m.reduce((s, c) => s + c.kwh, 0),
      count: m.length,
    };
  }, [charges]);
  const avg = useMemo(() => averagePrice(charges), [charges]);

  const remove = (id: string) => {
    const go = async () => {
      await deleteCharge(id);
      reload();
    };
    if (Platform.OS === 'web') {
      const ok = (globalThis as any).confirm ? (globalThis as any).confirm('Delete this charge?') : true;
      if (ok) go();
      return;
    }
    Alert.alert('Delete charge', 'Delete this charge?', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: go },
    ]);
  };

  const cur = prefs.currency;

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <TouchableOpacity style={styles.back} onPress={() => router.back()} activeOpacity={0.7}>
          <ArrowLeft size={22} color={C.textDim} />
        </TouchableOpacity>
        <Text style={styles.title}>Charging</Text>
        <TouchableOpacity style={styles.back} onPress={() => setSheet(true)} activeOpacity={0.7}>
          <Plus size={22} color={C.green} />
        </TouchableOpacity>
      </View>

      <FlatList
        data={charges}
        keyExtractor={(c) => c.id}
        contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: insets.bottom + 100 }}
        ListHeaderComponent={
          <>
            <View style={styles.kpis}>
              <Kpi value={fmtMoney(month.cost, cur)} label="This month" color={C.green} />
              <Kpi value={month.kwh.toFixed(0)} unit="kWh" label={`${month.count} ${month.count === 1 ? 'charge' : 'charges'}`} />
              <Kpi value={avg != null ? fmtMoney(avg, cur) : '—'} unit="/kWh" label="Your avg price" />
            </View>
            <Text style={styles.note}>
              {avg != null
                ? 'Trip costs use your average price from logged charges (recent charges count more).'
                : prefs.electricityPrice != null
                  ? `Until you log charges, trips use the fixed price from Settings (${fmtMoney(prefs.electricityPrice, cur)}/kWh).`
                  : 'Log your charges and every trip shows what it really cost.'}
            </Text>
            {charges.length > 0 && <Text style={styles.section}>History</Text>}
          </>
        }
        ListEmptyComponent={
          <View style={styles.empty}>
            <BatteryCharging size={36} color={C.textMute} strokeWidth={1.5} />
            <Text style={styles.emptyTitle}>No charges yet</Text>
            <Text style={styles.emptyBody}>
              Add a charge after you plug in — battery % before and after, and what you paid.
            </Text>
          </View>
        }
        renderItem={({ item }) => {
          const d = new Date(item.date);
          const Icon = item.type === 'home' ? HomeIcon : item.type === 'dc' ? Zap : PlugZap;
          return (
            <View style={styles.item}>
              <View style={styles.itemIcon}>
                <Icon size={18} color={item.type === 'dc' ? C.amber : C.green} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.itemTitle}>
                  {item.fromPct}% → {item.toPct}% · {item.kwh.toFixed(1)} kWh
                </Text>
                <Text style={styles.itemSub} numberOfLines={1}>
                  {d.toLocaleDateString(undefined, { day: 'numeric', month: 'short' })} ·{' '}
                  {CHARGE_TYPES.find((t) => t.key === item.type)?.label}
                  {item.place ? ` · ${item.place}` : ''}
                </Text>
              </View>
              <View style={{ alignItems: 'flex-end' }}>
                <Text style={styles.itemCost}>{fmtMoney(item.cost, cur)}</Text>
                <Text style={styles.itemSub}>{fmtMoney(pricePerKwh(item), cur)}/kWh</Text>
              </View>
              <TouchableOpacity onPress={() => remove(item.id)} hitSlop={10} style={{ marginLeft: 10 }}>
                <Trash2 size={18} color={C.textMute} />
              </TouchableOpacity>
            </View>
          );
        }}
      />

      <View style={[styles.bottom, { paddingBottom: insets.bottom + 12 }]}>
        <TouchableOpacity style={styles.add} onPress={() => setSheet(true)} activeOpacity={0.85}>
          <Zap size={18} color="#06240F" fill="#06240F" />
          <Text style={styles.addText}>Add charge</Text>
        </TouchableOpacity>
      </View>

      <ChargeSheet
        visible={sheet}
        capacityKwh={capacity}
        currency={cur}
        onClose={() => setSheet(false)}
        onSaved={() => {
          setSheet(false);
          reload();
        }}
      />
    </View>
  );
}

function Kpi({ value, unit, label, color = C.text }: { value: string; unit?: string; label: string; color?: string }) {
  return (
    <View style={styles.kpi}>
      <View style={{ flexDirection: 'row', alignItems: 'baseline', flexWrap: 'wrap', columnGap: 3 }}>
        <Text style={[styles.kpiValue, { color }]} numberOfLines={1}>
          {value}
        </Text>
        {unit ? <Text style={styles.kpiUnit}>{unit}</Text> : null}
      </View>
      <Text style={styles.kpiLabel}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: C.bg },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 8, paddingVertical: 6 },
  back: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  title: { fontSize: 18, fontFamily: F.bold, color: C.text },
  kpis: { flexDirection: 'row', gap: 8, marginTop: 4 },
  kpi: { flex: 1, backgroundColor: C.card, borderRadius: 16, padding: 14, borderWidth: 1, borderColor: C.border },
  kpiValue: { fontSize: 19, fontFamily: F.bold, letterSpacing: -0.4 },
  kpiUnit: { fontSize: 11, fontFamily: F.medium, color: C.textDim },
  kpiLabel: { fontSize: 11, fontFamily: F.medium, color: C.textMute, marginTop: 4 },
  note: { fontSize: 12, fontFamily: F.regular, color: C.textMute, marginTop: 10, lineHeight: 17 },
  section: {
    fontSize: 12,
    fontFamily: F.semibold,
    color: C.textDim,
    letterSpacing: 0.8,
    textTransform: 'uppercase',
    marginTop: 20,
    marginBottom: 8,
  },
  item: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: C.card,
    borderRadius: 16,
    padding: 14,
    borderWidth: 1,
    borderColor: C.border,
    marginBottom: 8,
  },
  itemIcon: { width: 36, height: 36, borderRadius: 18, backgroundColor: C.cardHi, alignItems: 'center', justifyContent: 'center' },
  itemTitle: { fontSize: 14.5, fontFamily: F.semibold, color: C.text },
  itemSub: { fontSize: 12, fontFamily: F.regular, color: C.textDim, marginTop: 2 },
  itemCost: { fontSize: 16, fontFamily: F.bold, color: C.text },
  empty: { alignItems: 'center', padding: 32, gap: 10, marginTop: 20 },
  emptyTitle: { fontSize: 17, fontFamily: F.bold, color: C.text },
  emptyBody: { fontSize: 13.5, fontFamily: F.regular, color: C.textDim, textAlign: 'center', lineHeight: 19 },
  bottom: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    paddingHorizontal: 16,
    paddingTop: 12,
    backgroundColor: C.bg,
    borderTopWidth: 1,
    borderTopColor: C.border,
  },
  add: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: C.green,
    borderRadius: 16,
    paddingVertical: 16,
  },
  addText: { color: '#06240F', fontFamily: F.bold, fontSize: 16 },
});
