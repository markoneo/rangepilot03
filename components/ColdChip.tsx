import { useEffect, useRef } from 'react';
import { Animated, Easing, Platform, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { Snowflake } from 'lucide-react-native';
import { F } from '@/constants/theme';

export const COLD_BLUE = '#7DD3FC';

/** "❄ 8°C" chip shown in the range card when it's cold. Pulses slowly; tap to see the note again. */
export function ColdChip({ tempC, onPress }: { tempC: number; onPress: () => void }) {
  const pulse = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, {
          toValue: 0.35,
          duration: 1400,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: Platform.OS !== 'web',
        }),
        Animated.timing(pulse, {
          toValue: 1,
          duration: 1400,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: Platform.OS !== 'web',
        }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [pulse]);

  return (
    <TouchableOpacity style={s.chip} onPress={onPress} activeOpacity={0.75} hitSlop={8}>
      <Animated.View style={{ opacity: pulse }}>
        <Snowflake size={20} color={COLD_BLUE} strokeWidth={2.4} />
      </Animated.View>
      <Text style={s.text}>{Math.round(tempC)}°C</Text>
    </TouchableOpacity>
  );
}

const s = StyleSheet.create({
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 11,
    paddingVertical: 5,
    borderRadius: 999,
    backgroundColor: COLD_BLUE + '1F',
    borderWidth: 1,
    borderColor: COLD_BLUE + '66',
    marginLeft: 8,
  },
  text: { color: COLD_BLUE, fontFamily: F.bold, fontSize: 15 },
});
