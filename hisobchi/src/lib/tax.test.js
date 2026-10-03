import { describe, expect, it } from 'vitest';
import { calcFromGross, calcFromNet, DEFAULT_RATES } from './tax.js';

describe('calcFromGross', () => {
  it('computes a 5 000 000 gross salary', () => {
    const r = calcFromGross(5_000_000);
    expect(r).toMatchObject({
      gross: 5_000_000,
      pitTotal: 600_000,
      inps: 5_000,
      pitToBudget: 595_000,
      net: 4_400_000,
      socialTax: 600_000,
      totalCost: 5_600_000,
    });
  });

  it('handles zero, negatives and garbage', () => {
    for (const v of [0, -100, NaN, undefined, 'abc']) {
      const r = calcFromGross(v);
      expect(r.net).toBe(0);
      expect(r.totalCost).toBe(0);
    }
  });

  it('stays exact for very large amounts', () => {
    const r = calcFromGross(9_999_999_999_999);
    expect(r.net + r.pitTotal).toBe(r.gross);
    expect(Number.isSafeInteger(r.totalCost)).toBe(true);
  });

  it('respects a custom social tax rate', () => {
    expect(calcFromGross(1_000_000, { ...DEFAULT_RATES, social: 0.25 }).socialTax).toBe(250_000);
  });
});

describe('calcFromNet', () => {
  it('reverses 4 400 000 net to 5 000 000 gross', () => {
    expect(calcFromNet(4_400_000).gross).toBe(5_000_000);
  });

  it('always yields net >= target with the smallest gross', () => {
    for (const net of [1, 7, 999, 1_271_000, 3_333_333, 12_345_678, 987_654_321]) {
      const r = calcFromNet(net);
      expect(r.net).toBeGreaterThanOrEqual(net);
      expect(calcFromGross(r.gross - 1).net).toBeLessThan(net);
    }
  });

  it('returns zeros for zero', () => {
    expect(calcFromNet(0).gross).toBe(0);
  });
});
