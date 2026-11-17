import { useEffect, useRef } from 'react';
import { Animated, Easing, Platform, StyleSheet, Text } from 'react-native';
import { Zap } from 'lucide-react-native';
import { C, F } from '@/constants/theme';

/** Shown only while the car is charging: a bolt that blinks once a second. */
export function ChargingBadge({ size = 30 }: { size?: number }) {
  const v = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    const native = Platform.OS !== 'web';
    const a = Animated.loop(
      Animated.sequence([
        Animated.timing(v, { toValue: 0.15, duration: 500, easing: Easing.inOut(Easing.quad), useNativeDriver: native }),
        Animated.timing(v, { toValue: 1, duration: 500, easing: Easing.inOut(Easing.quad), useNativeDriver: native }),
      ])
    );
    a.start();
    return () => a.stop();
  }, [v]);
  return (
    <Animated.View style={[s.wrap, { opacity: v }]} accessible accessibilityLabel="Charging">
      <Zap size={size} color={C.green} fill={C.green} strokeWidth={1.5} />
      <Text style={s.label}>Charging</Text>
    </Animated.View>
  );
}

const s = StyleSheet.create({
  wrap: { alignItems: 'center', gap: 2 },
  label: { fontSize: 12, fontFamily: F.semibold, color: C.green },
});
