import { useState, useEffect } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  KeyboardAvoidingView,
  Platform,
  Alert,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ArrowLeft, Download, Upload, ShieldCheck } from 'lucide-react-native';
import { exportBackup, pickBackup, restoreBackup, backupTripCount } from '@/utils/backup';
import {
  saveCarSettings,
  loadCarSettings,
  loadPrefs,
  savePrefs,
  DEFAULT_PREFS,
} from '@/utils/storage';
import { C, F } from '@/constants/theme';
import { Card, Chips, Label } from '@/components/ui';

const CURRENCIES = ['€', '$', '£', 'CHF'];
const RESERVES = [0, 5, 10, 15, 20];

export default function SettingsScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();

  const [carName, setCarName] = useState('');
  const [capacity, setCapacity] = useState('');
  const [price, setPrice] = useState('');
  const [currency, setCurrency] = useState(DEFAULT_PREFS.currency);
  const [reserve, setReserve] = useState(DEFAULT_PREFS.defaultReserve);
  const [isFirstRun, setIsFirstRun] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [backupMsg, setBackupMsg] = useState<string | null>(null);

  const doExport = async () => {
    setBackupMsg(null);
    try {
      await exportBackup();
      setBackupMsg('Backup saved.');
    } catch {
      setBackupMsg('Could not create the backup.');
    }
  };

  const doImport = async () => {
    setBackupMsg(null);
    try {
      const b = await pickBackup();
      if (!b) return;
      const n = backupTripCount(b);
      const text = `Restore this backup (${n} trip${n === 1 ? '' : 's'}, ${new Date(b.exportedAt).toLocaleDateString()})? It replaces the data on this device.`;
      const go = async () => {
        await restoreBackup(b);
        setBackupMsg('Backup restored.');
        router.replace('/');
      };
      if (Platform.OS === 'web') {
        if ((globalThis as any).confirm?.(text) ?? true) await go();
      } else {
        Alert.alert('Restore backup', text, [
          { text: 'Cancel', style: 'cancel' },
          { text: 'Restore', style: 'destructive', onPress: go },
        ]);
      }
    } catch (e: any) {
      setBackupMsg(e?.message || 'Could not read the backup file.');
    }
  };

  useEffect(() => {
    (async () => {
      const s = await loadCarSettings();
      if (s) {
        setCarName(s.carName);
        setCapacity(String(s.batteryCapacity));
      } else {
        setIsFirstRun(true);
      }
      const p = await loadPrefs();
      setPrice(p.electricityPrice != null ? String(p.electricityPrice) : '');
      setCurrency(p.currency);
      setReserve(p.defaultReserve);
      setLoading(false);
    })();
  }, []);

  const save = async () => {
    setError(null);
    if (!carName.trim()) return setError('Please enter your car name.');
    const cap = parseFloat(capacity.replace(',', '.'));
    if (isNaN(cap) || cap <= 0 || cap > 200) return setError('Battery capacity must be between 1 and 200 kWh.');
    const pr = price.trim() ? parseFloat(price.replace(',', '.')) : null;
    if (pr != null && (isNaN(pr) || pr < 0 || pr > 5)) return setError('Electricity price looks wrong (0–5 per kWh).');
    setSaving(true);
    await saveCarSettings({ carName: carName.trim(), batteryCapacity: cap });
    await savePrefs({ electricityPrice: pr, currency, defaultReserve: reserve });
    setSaving(false);
    if (router.canGoBack() && !isFirstRun) router.back();
    else router.replace('/');
  };

  if (loading) return <View style={styles.root} />;

  return (
    <KeyboardAvoidingView style={styles.root} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView
        contentContainerStyle={[styles.container, { paddingTop: insets.top + 8, paddingBottom: insets.bottom + 32 }]}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.header}>
          {!isFirstRun ? (
            <TouchableOpacity onPress={() => router.back()} style={styles.back} activeOpacity={0.7}>
              <ArrowLeft size={22} color={C.textDim} />
            </TouchableOpacity>
          ) : (
            <View style={styles.back} />
          )}
          <Text style={styles.title}>{isFirstRun ? 'Your car' : 'Settings'}</Text>
          <View style={styles.back} />
        </View>
        {isFirstRun && (
          <Text style={styles.intro}>Two quick details and you're ready to drive.</Text>
        )}

        <Card>
          <Label>Car</Label>
          <Text style={styles.fieldLabel}>Name</Text>
          <TextInput
            style={styles.input}
            placeholder="e.g. Forthing S7"
            placeholderTextColor={C.textMute}
            value={carName}
            onChangeText={setCarName}
            autoCapitalize="words"
          />
          <Text style={styles.fieldLabel}>Usable battery capacity</Text>
          <View style={styles.inputRow}>
            <TextInput
              style={[styles.input, { flex: 1 }]}
              placeholder="e.g. 60"
              placeholderTextColor={C.textMute}
              value={capacity}
              onChangeText={setCapacity}
              keyboardType="decimal-pad"
            />
            <Text style={styles.unit}>kWh</Text>
          </View>
        </Card>

        <Card>
          <Label>Default reserve</Label>
          <Text style={styles.help}>Range on the drive screen is shown to this % so you never arrive empty.</Text>
          <Chips
            options={RESERVES.map((v) => ({ label: v === 0 ? 'Off' : `${v}%`, value: v }))}
            value={reserve}
            onChange={setReserve}
          />
        </Card>

        <Card>
          <Label>Charging cost (optional)</Label>
          <Text style={styles.help}>Used for trip costs until you log charges (Charging screen) — then your real average price is used.</Text>
          <View style={styles.inputRow}>
            <TextInput
              style={[styles.input, { flex: 1 }]}
              placeholder="e.g. 0.25"
              placeholderTextColor={C.textMute}
              value={price}
              onChangeText={setPrice}
              keyboardType="decimal-pad"
            />
            <Text style={styles.unit}>{currency} / kWh</Text>
          </View>
          <View style={{ height: 12 }} />
          <Chips options={CURRENCIES.map((c) => ({ label: c, value: c }))} value={currency} onChange={setCurrency} />
        </Card>

        {!isFirstRun && (
          <Card>
            <Label>Backup</Label>
            <View style={styles.privacyRow}>
              <ShieldCheck size={16} color={C.green} />
              <Text style={styles.privacyText}>Your trips and settings are stored only on this phone — no account needed.</Text>
            </View>
            <Text style={styles.help}>Save a backup file now and then (e.g. to Google Drive or e-mail) to keep your trips safe or move them to a new phone.</Text>
            <View style={styles.backupRow}>
              <TouchableOpacity style={styles.backupBtn} onPress={doExport} activeOpacity={0.8}>
                <Download size={17} color={C.text} />
                <Text style={styles.backupText}>Save backup</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.backupBtn} onPress={doImport} activeOpacity={0.8}>
                <Upload size={17} color={C.text} />
                <Text style={styles.backupText}>Restore</Text>
              </TouchableOpacity>
            </View>
            {backupMsg && <Text style={styles.backupMsg}>{backupMsg}</Text>}
          </Card>
        )}

        {error && <Text style={styles.error}>{error}</Text>}

        <TouchableOpacity
          style={[styles.save, saving && { opacity: 0.6 }]}
          onPress={save}
          disabled={saving}
          activeOpacity={0.85}
        >
          <Text style={styles.saveText}>{saving ? 'Saving…' : isFirstRun ? 'Continue' : 'Save'}</Text>
        </TouchableOpacity>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: C.bg },
  container: { paddingHorizontal: 16 },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 },
  back: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  title: { fontSize: 20, fontFamily: F.bold, color: C.text },
  intro: { fontSize: 14, fontFamily: F.regular, color: C.textDim, textAlign: 'center', marginBottom: 16 },
  fieldLabel: { fontSize: 13, fontFamily: F.medium, color: C.textDim, marginBottom: 6, marginTop: 4 },
  input: {
    height: 52,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: C.borderHi,
    backgroundColor: C.bg,
    paddingHorizontal: 14,
    fontSize: 16,
    fontFamily: F.medium,
    color: C.text,
    marginBottom: 10,
  },
  inputRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  unit: { fontSize: 14, fontFamily: F.semibold, color: C.textDim, marginBottom: 10 },
  help: { fontSize: 12.5, fontFamily: F.regular, color: C.textMute, marginBottom: 12, marginTop: -4, lineHeight: 18 },
  privacyRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 8, marginBottom: 10 },
  privacyText: { flex: 1, fontSize: 13.5, fontFamily: F.medium, color: C.text, lineHeight: 19 },
  backupRow: { flexDirection: 'row', gap: 10 },
  backupBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    height: 48,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: C.borderHi,
    backgroundColor: C.bg,
  },
  backupText: { fontSize: 15, fontFamily: F.semibold, color: C.text },
  backupMsg: { fontSize: 13, fontFamily: F.medium, color: C.green, marginTop: 10 },
  error: { color: C.red, fontFamily: F.medium, fontSize: 13, textAlign: 'center', marginBottom: 10 },
  save: { backgroundColor: C.blue, borderRadius: 16, paddingVertical: 17, alignItems: 'center', marginTop: 4 },
  saveText: { fontSize: 17, fontFamily: F.semibold, color: '#fff' },
});
