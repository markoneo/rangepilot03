import { Text, TouchableOpacity, StyleSheet } from 'react-native';
import { Snowflake } from 'lucide-react-native';
import { F } from '@/constants/theme';

export const COLD_BLUE = '#7DD3FC';

/** Small "❄ 8°C" chip shown in the range card when it's cold. Tap to see the note again. */
export function ColdChip({ tempC, onPress }: { tempC: number; onPress: () => void }) {
  return (
    <TouchableOpacity style={s.chip} onPress={onPress} activeOpacity={0.75} hitSlop={8}>
      <Snowflake size={13} color={COLD_BLUE} />
      <Text style={s.text}>{Math.round(tempC)}°C</Text>
    </TouchableOpacity>
  );
}

const s = StyleSheet.create({
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 999,
    backgroundColor: COLD_BLUE + '1F',
    borderWidth: 1,
    borderColor: COLD_BLUE + '55',
    marginLeft: 6,
  },
  text: { color: COLD_BLUE, fontFamily: F.semibold, fontSize: 12 },
});
