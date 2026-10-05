import { ReactNode, useEffect, useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Modal,
  Pressable,
  TextInput,
  Platform,
  KeyboardAvoidingView,
  ViewStyle,
} from 'react-native';
import { Minus, Plus } from 'lucide-react-native';
import { C, F } from '@/constants/theme';

export function tap() {
  if (Platform.OS === 'web') return;
  import('expo-haptics')
    .then((H) => H.impactAsync(H.ImpactFeedbackStyle.Light))
    .catch(() => {});
}

export function Card({ children, style }: { children: ReactNode; style?: ViewStyle | ViewStyle[] }) {
  return <View style={[s.card, style as any]}>{children}</View>;
}

export function Label({ children, right }: { children: ReactNode; right?: ReactNode }) {
  return (
    <View style={s.labelRow}>
      <Text style={s.label}>{children}</Text>
      {right}
    </View>
  );
}

/** − value + row. Tap the value to type an exact number. Long-press ± for big steps. */
export function Stepper({
  value,
  unit,
  onMinus,
  onPlus,
  onMinusLong,
  onPlusLong,
  onPressValue,
  color = C.text,
  size = 'md',
}: {
  value: string;
  unit?: string;
  onMinus: () => void;
  onPlus: () => void;
  onMinusLong?: () => void;
  onPlusLong?: () => void;
  onPressValue?: () => void;
  color?: string;
  size?: 'md' | 'lg';
}) {
  const btn = size === 'lg' ? 60 : 48;
  return (
    <View style={s.stepRow}>
      <TouchableOpacity
        style={[s.stepBtn, { width: btn, height: btn, borderRadius: btn / 2 }]}
        onPress={() => {
          tap();
          onMinus();
        }}
        onLongPress={onMinusLong}
        delayLongPress={350}
        activeOpacity={0.7}
        accessibilityLabel="Decrease"
      >
        <Minus size={size === 'lg' ? 26 : 22} color={C.text} strokeWidth={2.5} />
      </TouchableOpacity>
      <TouchableOpacity
        style={s.stepValueWrap}
        onPress={onPressValue}
        disabled={!onPressValue}
        activeOpacity={0.7}
      >
        <Text style={[s.stepValue, size === 'lg' && s.stepValueLg, { color }]} numberOfLines={1}>
          {value}
          {unit ? <Text style={s.stepUnit}> {unit}</Text> : null}
        </Text>
        {onPressValue ? <Text style={s.stepHint}>tap to type</Text> : null}
      </TouchableOpacity>
      <TouchableOpacity
        style={[s.stepBtn, { width: btn, height: btn, borderRadius: btn / 2 }]}
        onPress={() => {
          tap();
          onPlus();
        }}
        onLongPress={onPlusLong}
        delayLongPress={350}
        activeOpacity={0.7}
        accessibilityLabel="Increase"
      >
        <Plus size={size === 'lg' ? 26 : 22} color={C.text} strokeWidth={2.5} />
      </TouchableOpacity>
    </View>
  );
}

export function Chips<T extends string | number>({
  options,
  value,
  onChange,
}: {
  options: { label: string; value: T; sub?: string }[];
  value: T | null;
  onChange: (v: T) => void;
}) {
  return (
    <View style={s.chips}>
      {options.map((o) => {
        const on = o.value === value;
        return (
          <TouchableOpacity
            key={String(o.value)}
            style={[s.chip, on && s.chipOn]}
            onPress={() => {
              tap();
              onChange(o.value);
            }}
            activeOpacity={0.75}
          >
            <Text style={[s.chipText, on && s.chipTextOn]}>{o.label}</Text>
            {o.sub ? <Text style={[s.chipSub, on && s.chipSubOn]}>{o.sub}</Text> : null}
          </TouchableOpacity>
        );
      })}
    </View>
  );
}

/** Bottom-sheet style numeric entry. */
export function NumberSheet({
  visible,
  title,
  subtitle,
  initial,
  unit,
  min,
  max,
  decimals = 1,
  confirmLabel = 'Apply',
  onConfirm,
  onClose,
  children,
}: {
  visible: boolean;
  title: string;
  subtitle?: string;
  initial: number;
  unit?: string;
  min: number;
  max: number;
  decimals?: number;
  confirmLabel?: string;
  onConfirm: (v: number) => void;
  onClose: () => void;
  children?: ReactNode;
}) {
  const [text, setText] = useState(String(initial));
  useEffect(() => {
    if (visible) setText(initial.toFixed(decimals).replace(/\.0+$/, ''));
  }, [visible, initial, decimals]);
  const num = parseFloat(text.replace(',', '.'));
  const valid = !isNaN(num) && num >= min && num <= max;
  const submit = () => {
    if (!valid) return;
    onConfirm(parseFloat(num.toFixed(decimals)));
  };
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <Pressable style={s.overlay} onPress={onClose}>
          <Pressable style={s.sheet} onPress={(e) => e.stopPropagation()}>
            <Text style={s.sheetTitle}>{title}</Text>
            {subtitle ? <Text style={s.sheetSub}>{subtitle}</Text> : null}
            <View style={s.sheetInputRow}>
              <TextInput
                style={[s.sheetInput, !valid && text.length > 0 && { borderColor: C.red }]}
                value={text}
                onChangeText={setText}
                keyboardType="decimal-pad"
                autoFocus
                selectTextOnFocus
                returnKeyType="done"
                onSubmitEditing={submit}
              />
              {unit ? <Text style={s.sheetUnit}>{unit}</Text> : null}
            </View>
            <Text style={s.sheetRange}>
              {min}–{max}
              {unit ? ` ${unit}` : ''}
            </Text>
            {children}
            <TouchableOpacity
              style={[s.primary, !valid && { opacity: 0.4 }]}
              onPress={submit}
              disabled={!valid}
              activeOpacity={0.85}
            >
              <Text style={s.primaryText}>{confirmLabel}</Text>
            </TouchableOpacity>
            <TouchableOpacity style={s.ghost} onPress={onClose} activeOpacity={0.7}>
              <Text style={s.ghostText}>Cancel</Text>
            </TouchableOpacity>
          </Pressable>
        </Pressable>
      </KeyboardAvoidingView>
    </Modal>
  );
}

export function Toast({ text, tone = 'green' }: { text: string | null; tone?: 'green' | 'blue' | 'amber' }) {
  if (!text) return null;
  const col = tone === 'green' ? C.green : tone === 'blue' ? C.blue : C.amber;
  const bg = tone === 'green' ? C.greenDim : tone === 'blue' ? C.blueDim : C.amberDim;
  return (
    <View style={[s.toast, { backgroundColor: bg, borderColor: col + '55' }]}>
      <Text style={[s.toastText, { color: col }]}>{text}</Text>
    </View>
  );
}

export const ui = StyleSheet.create({
  primary: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    backgroundColor: C.blue,
    borderRadius: 16,
    paddingVertical: 17,
  },
  primaryText: { fontSize: 17, fontFamily: F.semibold, color: '#FFFFFF' },
});

const s = StyleSheet.create({
  card: {
    backgroundColor: C.card,
    borderRadius: 20,
    padding: 18,
    borderWidth: 1,
    borderColor: C.border,
    marginBottom: 12,
  },
  labelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  label: {
    fontSize: 12,
    fontFamily: F.semibold,
    color: C.textDim,
    letterSpacing: 0.8,
    textTransform: 'uppercase',
  },
  stepRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  stepBtn: {
    backgroundColor: C.cardHi,
    borderWidth: 1,
    borderColor: C.borderHi,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepValueWrap: { flex: 1, alignItems: 'center' },
  stepValue: { fontSize: 28, fontFamily: F.bold, letterSpacing: -0.8 },
  stepValueLg: { fontSize: 36, letterSpacing: -1.2 },
  stepUnit: { fontSize: 14, fontFamily: F.medium, color: C.textDim, letterSpacing: 0 },
  stepHint: { fontSize: 10, fontFamily: F.medium, color: C.textMute, marginTop: 1 },
  chips: { flexDirection: 'row', gap: 8, flexWrap: 'wrap' },
  chip: {
    flexGrow: 1,
    minWidth: 56,
    paddingVertical: 10,
    paddingHorizontal: 10,
    borderRadius: 12,
    backgroundColor: C.cardHi,
    borderWidth: 1,
    borderColor: C.border,
    alignItems: 'center',
  },
  chipOn: { backgroundColor: C.blueDim, borderColor: C.blue },
  chipText: { fontSize: 14, fontFamily: F.semibold, color: C.textDim },
  chipTextOn: { color: C.text },
  chipSub: { fontSize: 11, fontFamily: F.medium, color: C.textMute, marginTop: 2 },
  chipSubOn: { color: '#93C5FD' },
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
  sheetTitle: { fontSize: 19, fontFamily: F.bold, color: C.text, textAlign: 'center' },
  sheetSub: {
    fontSize: 13,
    fontFamily: F.regular,
    color: C.textDim,
    textAlign: 'center',
    marginTop: 6,
    lineHeight: 18,
  },
  sheetInputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    marginTop: 18,
  },
  sheetInput: {
    flex: 1,
    height: 64,
    borderWidth: 2,
    borderColor: C.blue,
    borderRadius: 16,
    fontSize: 30,
    fontFamily: F.bold,
    color: C.text,
    textAlign: 'center',
    backgroundColor: C.bg,
  },
  sheetUnit: { fontSize: 16, fontFamily: F.semibold, color: C.textDim },
  sheetRange: {
    fontSize: 11,
    fontFamily: F.medium,
    color: C.textMute,
    textAlign: 'center',
    marginTop: 6,
    marginBottom: 14,
  },
  primary: {
    backgroundColor: C.blue,
    borderRadius: 14,
    paddingVertical: 15,
    alignItems: 'center',
    marginTop: 4,
  },
  primaryText: { fontSize: 16, fontFamily: F.semibold, color: '#FFFFFF' },
  ghost: { paddingVertical: 12, alignItems: 'center' },
  ghostText: { fontSize: 15, fontFamily: F.medium, color: C.textDim },
  toast: {
    marginHorizontal: 16,
    marginTop: 8,
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderRadius: 12,
    borderWidth: 1,
  },
  toastText: { fontSize: 13, fontFamily: F.semibold, textAlign: 'center' },
});
