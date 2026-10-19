import Decimal from 'decimal.js';

/**
 * TradePulse - Fee Calculator
 * Centralized, decimal-safe simulated fee and value calculations.
 */

export const DEFAULT_FEE_RATE = 0.0005; // 0.05%

/**
 * Calculates simulated fee in USDT for a given trade value.
 */
export function calculateFee(grossValue: number, feeRate: number = DEFAULT_FEE_RATE): number {
  if (!Number.isFinite(grossValue) || grossValue <= 0) return 0;
  const dValue = new Decimal(grossValue);
  const dRate = new Decimal(feeRate);
  return dValue.mul(dRate).toDecimalPlaces(4, Decimal.ROUND_HALF_UP).toNumber();
}

/**
 * Calculates total gross order value (price * quantity).
 */
export function calculateGrossValue(price: number, quantity: number): number {
  if (!Number.isFinite(price) || price <= 0 || !Number.isFinite(quantity) || quantity <= 0) return 0;
  const dPrice = new Decimal(price);
  const dQty = new Decimal(quantity);
  return dPrice.mul(dQty).toDecimalPlaces(4, Decimal.ROUND_HALF_UP).toNumber();
}

/**
 * Calculates total required USDT for a buy order (gross value + fee).
 */
export function calculateTotalBuyCost(price: number, quantity: number, feeRate: number = DEFAULT_FEE_RATE): number {
  const gross = calculateGrossValue(price, quantity);
  const fee = calculateFee(gross, feeRate);
  return new Decimal(gross).add(fee).toDecimalPlaces(4, Decimal.ROUND_HALF_UP).toNumber();
}

/**
 * Calculates net USDT proceeds received for a sell order (gross value - fee).
 */
export function calculateNetSellProceeds(price: number, quantity: number, feeRate: number = DEFAULT_FEE_RATE): number {
  const gross = calculateGrossValue(price, quantity);
  const fee = calculateFee(gross, feeRate);
  const net = new Decimal(gross).sub(fee);
  return net.greaterThan(0) ? net.toDecimalPlaces(4, Decimal.ROUND_HALF_UP).toNumber() : 0;
}

/**
 * Calculates max buyable quantity within available budget after fees:
 * quantity = budget / (price * (1 + feeRate))
 */
export function calculateAffordableQuantity(
  budget: number,
  price: number,
  feeRate: number = DEFAULT_FEE_RATE
): number {
  if (!Number.isFinite(budget) || budget <= 0 || !Number.isFinite(price) || price <= 0) return 0;
  const dBudget = new Decimal(budget);
  const dPrice = new Decimal(price);
  const dMultiplier = new Decimal(1).add(feeRate);
  const dCostPerUnit = dPrice.mul(dMultiplier);
  return dBudget.div(dCostPerUnit).toDecimalPlaces(8, Decimal.ROUND_DOWN).toNumber();
}
