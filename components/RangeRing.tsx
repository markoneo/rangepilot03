import { useEffect, useRef, useState } from 'react';
import { AccessibilityInfo, Animated, Easing, Platform, StyleSheet, Text, View } from 'react-native';
import Svg, { Circle } from 'react-native-svg';
import { C, F } from '@/constants/theme';

const STROKE = 13;

function hex(c: string): [number, number, number] {
  const n = parseInt(c.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
function mix(a: string, b: string, t: number): string {
  const x = hex(a);
  const y = hex(b);
  const k = Math.max(0, Math.min(1, t));
  const v = x.map((p, i) => Math.round(p + (y[i] - p) * k));
  return `#${v.map((p) => p.toString(16).padStart(2, '0')).join('')}`;
}

/**
 * Ring colour for the battery that is still usable (above the reserve):
 * green while there is plenty, then gradually through amber to red.
 */
export function ringColor(usablePct: number): string {
  if (usablePct >= 40) return C.green;
  if (usablePct >= 20) return mix(C.amber, C.green, (usablePct - 20) / 20);
  if (usablePct >= 5) return mix(C.red, C.amber, (usablePct - 5) / 15);
  return C.red;
}

/**
 * The big range dial: the arc is the battery left, the number is the range.
 * A soft light travels slowly around the arc while the drive is running.
 */
export function RangeRing({
  km,
  batteryPct,
  usablePct,
  label,
  sub,
  moving = true,
  size = 220,
}: {
  km: number;
  batteryPct: number;
  usablePct: number;
  label: string;
  sub?: string | null;
  moving?: boolean;
  size?: number;
}) {
  const h = size / 2;
  const r = h - 16;
  const c = 2 * Math.PI * r;
  const pct = Math.max(0, Math.min(100, batteryPct));
  const dash = (c * pct) / 100;
  const color = ringColor(usablePct);
  const light = mix(color, '#FFFFFF', 0.62);
  const low = usablePct < 10;

  const [calm, setCalm] = useState(false);
  useEffect(() => {
    AccessibilityInfo.isReduceMotionEnabled()
      .then(setCalm)
      .catch(() => {});
  }, []);
  const animate = moving && !calm && pct > 3;

  const spin = useRef(new Animated.Value(0)).current;
  const glow = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (!animate) {
      spin.setValue(0);
      glow.setValue(0);
      return;
    }
    const native = Platform.OS !== 'web';
    const a = Animated.loop(
      Animated.timing(spin, {
        toValue: 1,
        duration: low ? 4000 : 7000,
        easing: Easing.linear,
        useNativeDriver: native,
      })
    );
    const half = low ? 1000 : 2000;
    const b = Animated.loop(
      Animated.sequence([
        Animated.timing(glow, { toValue: 1, duration: half, easing: Easing.inOut(Easing.quad), useNativeDriver: native }),
        Animated.timing(glow, { toValue: 0, duration: half, easing: Easing.inOut(Easing.quad), useNativeDriver: native }),
      ])
    );
    a.start();
    b.start();
    return () => {
      a.stop();
      b.stop();
    };
  }, [animate, low]);

  const rotate = spin.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '360deg'] });
  const glowOpacity = glow.interpolate({ inputRange: [0, 1], outputRange: [0.1, 0.32] });
  const top = `rotate(-90 ${h} ${h})`;
  // the part of the ring that is not filled, drawn over the travelling light
  const cap = STROKE / 2;
  const rest = c - dash - 2 * cap;

  return (
    <View
      style={{ width: size, height: size, alignSelf: 'center' }}
      accessible
      accessibilityLabel={`${label}: ${Math.round(km)} kilometres${sub ? `, ${sub}` : ''}`}
    >
      {/* soft glow behind the arc */}
      <Animated.View style={[StyleSheet.absoluteFill, { opacity: animate ? glowOpacity : 0.12 }]}>
        <Svg width={size} height={size}>
          <Circle
            cx={h}
            cy={h}
            r={r}
            fill="none"
            stroke={color}
            strokeWidth={STROKE + 12}
            strokeLinecap="round"
            strokeDasharray={[dash, c]}
            transform={top}
          />
        </Svg>
      </Animated.View>

      <Svg width={size} height={size} style={StyleSheet.absoluteFill}>
        <Circle cx={h} cy={h} r={h - 1} fill="none" stroke={C.cardHi} strokeWidth={1} />
        <Circle cx={h} cy={h} r={r} fill="none" stroke={C.cardHi} strokeWidth={STROKE} />
        {pct > 0 && (
          <Circle
            cx={h}
            cy={h}
            r={r}
            fill="none"
            stroke={color}
            strokeWidth={STROKE}
            strokeLinecap="round"
            strokeDasharray={[dash, c]}
            transform={top}
          />
        )}
      </Svg>

      {/* the travelling light: a short bright stretch with a fading tail */}
      {animate && (
        <Animated.View style={[StyleSheet.absoluteFill, { transform: [{ rotate }] }]}>
          <Svg width={size} height={size}>
            {[0.16, 0.11, 0.06].map((len, i) => (
              <Circle
                key={len}
                cx={h}
                cy={h}
                r={r}
                fill="none"
                stroke={light}
                strokeOpacity={0.22 + i * 0.14}
                strokeWidth={STROKE}
                strokeLinecap="round"
                strokeDasharray={[c * len, c]}
                strokeDashoffset={-c * (0.16 - len)}
                transform={top}
              />
            ))}
          </Svg>
        </Animated.View>
      )}
      {animate && rest > 0 && (
        <Svg width={size} height={size} style={StyleSheet.absoluteFill}>
          <Circle
            cx={h}
            cy={h}
            r={r}
            fill="none"
            stroke={C.cardHi}
            strokeWidth={STROKE + 1}
            strokeDasharray={[rest, c]}
            strokeDashoffset={-(dash + cap)}
            transform={top}
          />
        </Svg>
      )}

      <View style={[StyleSheet.absoluteFill, s.center]}>
        <Text style={s.label}>{label}</Text>
        <Text style={[s.km, usablePct <= 0 ? { color: C.red } : null]} numberOfLines={1} adjustsFontSizeToFit>
          {Math.round(km)}
        </Text>
        <Text style={s.unit}>km</Text>
        {sub ? <Text style={[s.sub, { color }]}>{sub}</Text> : null}
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  center: { alignItems: 'center', justifyContent: 'center', paddingHorizontal: 34 },
  label: { fontSize: 12, fontFamily: F.semibold, color: C.textDim, letterSpacing: 0.6, textTransform: 'uppercase' },
  km: { fontSize: 68, lineHeight: 70, fontFamily: F.display, color: C.text, letterSpacing: -2.5 },
  unit: { fontSize: 15, fontFamily: F.semibold, color: C.textDim, marginTop: -2 },
  sub: { fontSize: 12, fontFamily: F.semibold, marginTop: 4 },
});
