import { useEffect, useMemo, useRef, useState } from 'react';
import { AccessibilityInfo, Animated, Easing, Platform, StyleSheet, View } from 'react-native';
import Svg, { Path } from 'react-native-svg';

const AMP = 5; // wave height in px
const NATIVE = Platform.OS !== 'web';

/** A wave line across `width` with `periods` full waves, closed downwards to `height`. */
function wavePath(width: number, height: number, periods: number, amp: number, flip: boolean): string {
  const half = width / periods / 2;
  const y = AMP;
  let d = `M0 ${y}`;
  for (let i = 0; i < periods * 2; i++) {
    const up = (i % 2 === 0) !== flip;
    d += ` Q${(i + 0.5) * half} ${y + (up ? -amp : amp) * 2} ${(i + 1) * half} ${y}`;
  }
  return `${d} V${height} H0 Z`;
}

/**
 * The liquid in the battery drawing: fills the box to `pct` with a surface
 * that moves in slow waves. The level glides when the battery % changes; while
 * charging the waves are livelier and small bubbles rise.
 * Stands still when `moving` is off or the phone asks for reduced motion.
 */
export function LiquidFill({
  pct,
  color,
  width,
  height,
  moving = true,
  charging = false,
}: {
  pct: number;
  color: string;
  width: number;
  height: number;
  moving?: boolean;
  charging?: boolean;
}) {
  const p = Math.max(0, Math.min(100, pct));
  const [calm, setCalm] = useState(false);
  useEffect(() => {
    AccessibilityInfo.isReduceMotionEnabled()
      .then(setCalm)
      .catch(() => {});
  }, []);
  const animate = moving && !calm && width > 0 && height > 0 && p > 0;

  // level: top of the liquid, measured from the top of the box
  const topFor = (v: number) => height * (1 - v / 100) - AMP;
  const level = useRef(new Animated.Value(topFor(p))).current;
  const first = useRef(true);
  useEffect(() => {
    if (height <= 0) return;
    if (first.current || calm) {
      first.current = false;
      level.setValue(topFor(p));
      return;
    }
    const a = Animated.timing(level, {
      toValue: topFor(p),
      duration: 700,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: NATIVE,
    });
    a.start();
    return () => a.stop();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [p, height, calm]);

  // waves: two layers drifting in opposite directions
  const front = useRef(new Animated.Value(0)).current;
  const back = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (!animate) {
      front.setValue(0);
      back.setValue(0);
      return;
    }
    const run = (v: Animated.Value, ms: number) =>
      Animated.loop(Animated.timing(v, { toValue: 1, duration: ms, easing: Easing.linear, useNativeDriver: NATIVE }));
    const a = run(front, charging ? 2600 : 5000);
    const b = run(back, charging ? 4200 : 8000);
    a.start();
    b.start();
    return () => {
      a.stop();
      b.stop();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [animate, charging]);

  // bubbles while charging
  const bubbles = useRef([0, 1, 2].map(() => new Animated.Value(0))).current;
  const bubbling = animate && charging && p > 8;
  useEffect(() => {
    if (!bubbling) {
      bubbles.forEach((b) => b.setValue(0));
      return;
    }
    const loops = bubbles.map((b, i) =>
      Animated.loop(
        Animated.sequence([
          Animated.delay(i * 700),
          Animated.timing(b, { toValue: 1, duration: 2200, easing: Easing.linear, useNativeDriver: NATIVE }),
          Animated.timing(b, { toValue: 0, duration: 0, useNativeDriver: NATIVE }),
        ])
      )
    );
    loops.forEach((l) => l.start());
    return () => loops.forEach((l) => l.stop());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bubbling]);

  const amp = animate ? (charging ? AMP : AMP * 0.8) : 0;
  const h = height + AMP * 2;
  const paths = useMemo(
    () => ({ front: wavePath(width * 2, h, 4, amp, false), back: wavePath(width * 2, h, 4, amp, true) }),
    [width, h, amp]
  );
  if (width <= 0 || height <= 0) return null;
  const liquidPx = (height * p) / 100;

  return (
    <Animated.View
      pointerEvents="none"
      style={[styles.liquid, { height: h, transform: [{ translateY: level }] }]}
    >
      <Animated.View
        style={[
          styles.wave,
          { width: width * 2, transform: [{ translateX: back.interpolate({ inputRange: [0, 1], outputRange: [-width, 0] }) }] },
        ]}
      >
        <Svg width={width * 2} height={h}>
          <Path d={paths.back} fill={color} opacity={0.45} />
        </Svg>
      </Animated.View>
      <Animated.View
        style={[
          styles.wave,
          { width: width * 2, transform: [{ translateX: front.interpolate({ inputRange: [0, 1], outputRange: [0, -width] }) }] },
        ]}
      >
        <Svg width={width * 2} height={h}>
          <Path d={paths.front} fill={color} />
        </Svg>
      </Animated.View>
      {bubbling &&
        bubbles.map((b, i) => {
          const size = 5 + i * 2;
          return (
            <Animated.View
              key={i}
              style={[
                styles.bubble,
                {
                  width: size,
                  height: size,
                  borderRadius: size / 2,
                  left: width * (0.22 + i * 0.27),
                  opacity: b.interpolate({ inputRange: [0, 0.15, 0.8, 1], outputRange: [0, 0.55, 0.55, 0] }),
                  transform: [
                    {
                      translateY: b.interpolate({
                        inputRange: [0, 1],
                        outputRange: [AMP + liquidPx - size, AMP + 6],
                      }),
                    },
                  ],
                },
              ]}
            />
          );
        })}
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  liquid: { position: 'absolute', left: 0, right: 0, top: 0 },
  wave: { position: 'absolute', left: 0, top: 0 },
  bubble: { position: 'absolute', top: 0, backgroundColor: '#FFFFFF' },
});
