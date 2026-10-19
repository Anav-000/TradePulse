import { describe, it, expect } from 'vitest';
import {
  formatCurrency,
  formatPercentage,
  formatCompactNumber,
  formatCompactCurrency,
  formatOrderBookQuantity,
} from './formatters';

describe('Financial Formatters', () => {
  it('formats standard currency values correctly', () => {
    expect(formatCurrency(67842.5)).toBe('$67,842.50');
    expect(formatCurrency(0)).toBe('$0.00');
    expect(formatCurrency(-150.25)).toBe('-$150.25');
  });

  it('formats low-value cryptocurrency prices with higher precision', () => {
    expect(formatCurrency(0.5842)).toBe('$0.5842');
    expect(formatCurrency(0.00004215)).toBe('$0.00004215');
  });

  it('formats percentages with explicit signs', () => {
    expect(formatPercentage(2.92)).toBe('+2.92%');
    expect(formatPercentage(-3.52)).toBe('-3.52%');
    expect(formatPercentage(0)).toBe('0.00%');
  });

  it('formats compact numbers and currencies', () => {
    expect(formatCompactNumber(1250000)).toBe('1.25M');
    expect(formatCompactCurrency(2841029410)).toBe('$2.84B');
  });

  it('formats order book quantities with adaptive precision preventing 0.000 rounding', () => {
    expect(formatOrderBookQuantity(0)).toBe('0.00');
    expect(formatOrderBookQuantity(0.000045)).toBe('0.000045');
    expect(formatOrderBookQuantity(0.0045)).toBe('0.00450');
    expect(formatOrderBookQuantity(0.45)).toBe('0.4500');
    expect(formatOrderBookQuantity(12.5)).toBe('12.500');
    expect(formatOrderBookQuantity(1540.25)).toBe('1540.25');
    expect(formatOrderBookQuantity(25000)).toBe('25K');
  });
});
