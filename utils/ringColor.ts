import { C } from '@/constants/theme';

function hex(c: string): [number, number, number] {
  const n = parseInt(c.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
export function mix(a: string, b: string, t: number): string {
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
