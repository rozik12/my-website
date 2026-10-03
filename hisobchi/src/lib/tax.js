// Ставки по Налоговому кодексу РУз (2026):
// - НДФЛ 12% (ст. 381 НК).
// - ИНПС 0,1% от начисленной зарплаты; сумма НДФЛ к уплате в бюджет
//   уменьшается на сумму взноса ИНПС, поэтому сотрудник в сумме теряет 12%.
// - Социальный налог работодателя 12% (бюджетные организации — 25%).
export const DEFAULT_RATES = Object.freeze({
  pit: 0.12,
  inps: 0.001,
  social: 0.12,
});

export const SOCIAL_TAX_PRESETS = Object.freeze([
  { id: 'standard', label: '12% — стандартная ставка', rate: 0.12 },
  { id: 'budget', label: '25% — бюджетные организации', rate: 0.25 },
  { id: 'custom', label: 'Своя ставка', rate: null },
]);

const roundSum = (x) => Math.round(x);

export function calcFromGross(gross, rates = DEFAULT_RATES) {
  const g = Math.max(0, roundSum(Number(gross) || 0));
  const pitTotal = roundSum(g * rates.pit);
  const inps = Math.min(roundSum(g * rates.inps), pitTotal);
  const pitToBudget = pitTotal - inps;
  const net = g - pitTotal;
  const socialTax = roundSum(g * rates.social);
  const totalCost = g + socialTax;

  return {
    gross: g,
    pitTotal,
    pitToBudget,
    inps,
    net,
    socialTax,
    totalCost,
    employeeDeductions: pitTotal,
    allTaxes: pitTotal + socialTax,
  };
}

export function calcFromNet(net, rates = DEFAULT_RATES) {
  const target = Math.max(0, roundSum(Number(net) || 0));
  if (target === 0) return calcFromGross(0, rates);

  let gross = roundSum(target / (1 - rates.pit));
  while (calcFromGross(gross, rates).net < target) gross += 1;
  while (gross > 0 && calcFromGross(gross - 1, rates).net >= target) gross -= 1;
  return calcFromGross(gross, rates);
}

export function calculate({ amount, mode = 'gross', rates = DEFAULT_RATES }) {
  return mode === 'net' ? calcFromNet(amount, rates) : calcFromGross(amount, rates);
}

export function scale(result, factor) {
  return Object.fromEntries(Object.entries(result).map(([k, v]) => [k, v * factor]));
}
