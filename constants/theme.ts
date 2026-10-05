export const C = {
  bg: '#0B0F14',
  card: '#121821',
  cardHi: '#18202B',
  border: '#1F2937',
  borderHi: '#2B3646',
  text: '#F3F6FA',
  textDim: '#9AA4B2',
  textMute: '#5F6B7A',
  blue: '#3B82F6',
  blueDim: '#14233D',
  green: '#22C55E',
  greenDim: '#0E2A1A',
  amber: '#F59E0B',
  amberDim: '#2E2108',
  orange: '#F97316',
  orangeDim: '#33190A',
  red: '#EF4444',
  redDim: '#2E1212',
};

export const F = {
  regular: 'Inter-Regular',
  medium: 'Inter-Medium',
  semibold: 'Inter-SemiBold',
  bold: 'Inter-Bold',
};

export function batteryColor(pct: number): string {
  if (pct >= 50) return C.green;
  if (pct >= 20) return C.amber;
  return C.red;
}

export function fmtMoney(amount: number, currency: string): string {
  const v = amount.toFixed(2);
  return currency.length <= 1 ? `${currency}${v}` : `${v} ${currency}`;
}
