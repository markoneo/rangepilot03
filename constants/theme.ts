export const C = {
  bg: '#0B0E11',
  card: '#12161B',
  cardHi: '#1B2229',
  border: '#1B2229',
  borderHi: '#2A323A',
  text: '#F2F5F7',
  textDim: '#8B95A1',
  textMute: '#5C6670',
  // The single accent. Still called "blue" across the app; it is green now.
  blue: '#34D17A',
  blueDim: '#12261B',
  /** Text and icons on top of the accent colour */
  onAccent: '#06130C',
  green: '#34D17A',
  greenDim: '#0F1F17',
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
  /** Big numbers and screen titles */
  display: 'Bricolage-ExtraBold',
  displayBold: 'Bricolage-Bold',
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
