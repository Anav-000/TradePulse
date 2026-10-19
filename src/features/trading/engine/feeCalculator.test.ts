import { describe, it, expect } from 'vitest';
import {
  calculateFee,
  calculateGrossValue,
  calculateTotalBuyCost,
  calculateNetSellProceeds,
  calculateAffordableQuantity,
} from './feeCalculator';

describe('Fee Calculator Engine', () => {
  it('calculates 0.05% fee accurately with decimal safety', () => {
    // $10,000 gross value * 0.0005 = $5.00 fee
    expect(calculateFee(10000)).toBe(5);
    // $8,150.00 * 0.0005 = $4.075 -> $4.08 rounded
    expect(calculateFee(8150)).toBe(4.075);
    expect(calculateFee(0)).toBe(0);
    expect(calculateFee(-100)).toBe(0);
  });

  it('calculates gross order value', () => {
    expect(calculateGrossValue(80000, 0.5)).toBe(40000);
    expect(calculateGrossValue(2500, 2)).toBe(5000);
    expect(calculateGrossValue(0, 5)).toBe(0);
  });

  it('calculates total buy cost including fees', () => {
    // 0.1 BTC @ $80,000 = $8,000 gross + $4 fee = $8,004
    expect(calculateTotalBuyCost(80000, 0.1)).toBe(8004);
  });

  it('calculates net sell proceeds after fee deduction', () => {
    // 0.1 BTC @ $80,000 = $8,000 gross - $4 fee = $7,996
    expect(calculateNetSellProceeds(80000, 0.1)).toBe(7996);
  });

  it('calculates max affordable buy quantity within available budget after fees', () => {
    // $10,000 budget at $50,000/BTC with 0.05% fee
    // 10000 / (50000 * 1.0005) = 10000 / 50025 = 0.1999000499...
    const affordable = calculateAffordableQuantity(10000, 50000);
    expect(affordable).toBeCloseTo(0.1999, 4);
    // Total cost of that affordable qty must not exceed budget
    expect(calculateTotalBuyCost(50000, affordable)).toBeLessThanOrEqual(10000);
  });
});
