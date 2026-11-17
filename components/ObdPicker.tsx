import { useEffect, useState } from 'react';
import { ActivityIndicator, Modal, Pressable, ScrollView, StyleSheet, Text, TouchableOpacity } from 'react-native';
import { Bluetooth } from 'lucide-react-native';
import { C, F } from '@/constants/theme';
import { connectObd, scanObdAdapters } from '@/utils/obd';
import type { FoundAdapter } from '@/utils/obdTransport';

/** Native apps: list nearby Bluetooth adapters and let the driver pick theirs. */
export function ObdPicker({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const [found, setFound] = useState<FoundAdapter[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!visible) return;
    setFound([]);
    setError(null);
    return scanObdAdapters(
      (a) => setFound((list) => (list.some((x) => x.id === a.id) ? list : [...list, a])),
      setError
    );
  }, [visible]);

  // likely OBD adapters first
  const sorted = [...found].sort((a, b) => Number(likely(b.name)) - Number(likely(a.name)));

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={s.overlay} onPress={onClose}>
        <Pressable style={s.card} onPress={(e) => e.stopPropagation()}>
          <Text style={s.title}>Choose your OBD adapter</Text>
          <Text style={s.body}>
            Plug the adapter into the car and switch the car on. The adapter must be Bluetooth LE (BLE); classic
            Bluetooth adapters do not connect to an iPhone.
          </Text>
          {error ? (
            <Text style={s.error}>{error}</Text>
          ) : (
            <ScrollView style={s.list}>
              {sorted.map((a) => (
                <TouchableOpacity
                  key={a.id}
                  style={s.item}
                  activeOpacity={0.8}
                  onPress={() => {
                    onClose();
                    connectObd(a.id);
                  }}
                >
                  <Bluetooth size={16} color={likely(a.name) ? C.green : C.textMute} strokeWidth={2.4} />
                  <Text style={s.itemText} numberOfLines={1}>
                    {a.name}
                  </Text>
                </TouchableOpacity>
              ))}
              <ActivityIndicator color={C.textMute} style={{ marginVertical: 14 }} />
            </ScrollView>
          )}
          <TouchableOpacity style={s.cancel} onPress={onClose} activeOpacity={0.7}>
            <Text style={s.cancelText}>Cancel</Text>
          </TouchableOpacity>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const likely = (name: string) => /vlink|vgate|obd|elm|icar|veepeak|carista|konnwei/i.test(name);

const s = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.65)', justifyContent: 'center', alignItems: 'center', padding: 24 },
  card: { width: '100%', maxWidth: 380, maxHeight: '75%', backgroundColor: C.card, borderRadius: 24, padding: 22 },
  title: { fontSize: 20, fontFamily: F.displayBold, letterSpacing: -0.4, color: C.text },
  body: { fontSize: 14, fontFamily: F.regular, color: C.textDim, lineHeight: 20, marginTop: 6, marginBottom: 8 },
  error: { fontSize: 14.5, fontFamily: F.regular, color: C.text, lineHeight: 21, marginVertical: 14 },
  list: { flexGrow: 0 },
  item: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 14 },
  itemText: { flex: 1, fontSize: 16, fontFamily: F.medium ?? F.regular, color: C.text },
  cancel: { paddingVertical: 12, alignItems: 'center', marginTop: 4 },
  cancelText: { fontSize: 15, fontFamily: F.bold, color: C.textDim },
});
