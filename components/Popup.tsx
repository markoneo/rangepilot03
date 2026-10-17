import type { ReactNode } from 'react';
import { Modal, Pressable, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { C, F } from '@/constants/theme';

export function Popup({
  visible,
  icon,
  tone = C.blue,
  title,
  body,
  primary,
  secondary,
  onDismiss,
}: {
  visible: boolean;
  icon?: ReactNode;
  tone?: string;
  title: string;
  body?: string;
  primary: { label: string; onPress: () => void };
  secondary?: { label: string; onPress: () => void };
  onDismiss: () => void;
}) {
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onDismiss}>
      <Pressable style={s.overlay} onPress={onDismiss}>
        <Pressable style={s.card} onPress={(e) => e.stopPropagation()}>
          {icon ? <View style={[s.icon, { backgroundColor: tone + '22' }]}>{icon}</View> : null}
          <Text style={s.title}>{title}</Text>
          {body ? <Text style={s.body}>{body}</Text> : null}
          <TouchableOpacity style={[s.primary, { backgroundColor: tone }]} onPress={primary.onPress} activeOpacity={0.85}>
            <Text style={s.primaryText}>{primary.label}</Text>
          </TouchableOpacity>
          {secondary ? (
            <TouchableOpacity style={s.secondary} onPress={secondary.onPress} activeOpacity={0.7}>
              <Text style={s.secondaryText}>{secondary.label}</Text>
            </TouchableOpacity>
          ) : null}
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const s = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.65)', justifyContent: 'center', alignItems: 'center', padding: 24 },
  card: {
    width: '100%',
    maxWidth: 380,
    backgroundColor: C.card,
    borderRadius: 24,
    padding: 24,
    borderWidth: 1,
    borderColor: C.borderHi,
    alignItems: 'center',
  },
  icon: { width: 56, height: 56, borderRadius: 28, alignItems: 'center', justifyContent: 'center', marginBottom: 14 },
  title: { fontSize: 19, fontFamily: F.bold, color: C.text, textAlign: 'center', lineHeight: 25 },
  body: { fontSize: 14.5, fontFamily: F.regular, color: C.textDim, textAlign: 'center', lineHeight: 21, marginTop: 8 },
  primary: { alignSelf: 'stretch', borderRadius: 14, paddingVertical: 15, alignItems: 'center', marginTop: 20 },
  primaryText: { color: '#06240F', fontFamily: F.bold, fontSize: 16 },
  secondary: { alignSelf: 'stretch', paddingVertical: 12, alignItems: 'center', marginTop: 2 },
  secondaryText: { color: C.textDim, fontFamily: F.medium, fontSize: 15 },
});
