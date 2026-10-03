const NBSP = '\u00A0';

export function groupDigits(value, sep = NBSP) {
  const n = Math.round(Number(value) || 0);
  const sign = n < 0 ? '−' : '';
  return sign + String(Math.abs(n)).replace(/\B(?=(\d{3})+(?!\d))/g, sep);
}

export function formatSum(value) {
  return `${groupDigits(value)}${NBSP}сум`;
}

export function formatPercent(rate) {
  const pct = Math.round(rate * 100 * 1000) / 1000;
  return `${String(pct).replace('.', ',')}%`;
}

export const MAX_DIGITS = 13;

export function parseDigits(text) {
  const digits = String(text ?? '').replace(/\D/g, '').replace(/^0+(?=\d)/, '').slice(0, MAX_DIGITS);
  return digits === '' ? null : Number(digits);
}
