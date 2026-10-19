import { describe, it, expect } from 'vitest';
import {
  validateOrderBasics,
  validateQuoteFreshness,
  validateMarketOrder,
  validateLimitOrder,
  countDecimals,
  getMaxPriceDecimals,
  MAX_QUANTITY_DECIMALS,
  MIN_ORDER_NOTIONAL_USDT,
  MAX_SAFE_QUANTITY,
  MAX_SAFE_PRICE,
} from './orderValidator';
import { LiveQuote, Position } from '../types';

describe('Order Validator Engine', () => {
  const mockQuote: LiveQuote = {
    symbol: 'BTCUSDT',
    bidPrice: 81490,
    askPrice: 81510,
    lastPrice: 81500,
    timestamp: Date.now(),
  };

  const mockPosition: Position = {
    symbol: 'BTCUSDT',
    baseAsset: 'BTC',
    quoteAsset: 'USDT',
    quantity: 1.5,
    reservedQuantity: 0.5,
    availableQuantity: 1.0,
    averageEntryPrice: 80000,
    totalCostBasis: 120000,
    realizedPnl: 0,
    openedAt: Date.now() - 100000,
    updatedAt: Date.now(),
  };

  it('rejects invalid or non-positive basics (NaN, zero, negative)', () => {
    expect(validateOrderBasics(0).isValid).toBe(false);
    expect(validateOrderBasics(-1).isValid).toBe(false);
    expect(validateOrderBasics(NaN).isValid).toBe(false);
    expect(validateOrderBasics(1, -50).isValid).toBe(false);
    expect(validateOrderBasics(1, 50000).isValid).toBe(true);
  });

  it('validates quote freshness and rejects stale quotes (>60s)', () => {
    const now = Date.now();
    expect(validateQuoteFreshness(mockQuote, 'buy', now).isValid).toBe(true);
    expect(validateQuoteFreshness(mockQuote, 'buy', now).executablePrice).toBe(81510);
    expect(validateQuoteFreshness(mockQuote, 'sell', now).executablePrice).toBe(81490);

    const staleQuote = { ...mockQuote, timestamp: now - 75000 };
    const staleResult = validateQuoteFreshness(staleQuote, 'buy', now);
    expect(staleResult.isValid).toBe(false);
    expect(staleResult.error).toMatch(/stale/i);

    expect(validateQuoteFreshness(null, 'buy', now).isValid).toBe(false);
  });

  it('validates market buy against available USDT', () => {
    // 0.1 BTC @ $81,510 = $8,151 + fee ~$8,155
    const valid = validateMarketOrder('buy', 0.1, mockQuote, 50000);
    expect(valid.isValid).toBe(true);
    expect(valid.executablePrice).toBe(81510);

    // Exceeds available USDT ($5,000 available < ~$8,155 required)
    const insufficient = validateMarketOrder('buy', 0.1, mockQuote, 5000);
    expect(insufficient.isValid).toBe(false);
    expect(insufficient.error).toMatch(/insufficient available usdt/i);
  });

  it('validates market sell against available asset holdings', () => {
    // Has 1.0 available BTC
    const validSell = validateMarketOrder('sell', 0.5, mockQuote, 50000, mockPosition);
    expect(validSell.isValid).toBe(true);
    expect(validSell.executablePrice).toBe(81490);

    // Selling 1.2 BTC when only 1.0 is available
    const insufficientHolding = validateMarketOrder('sell', 1.2, mockQuote, 50000, mockPosition);
    expect(insufficientHolding.isValid).toBe(false);
    expect(insufficientHolding.error).toMatch(/insufficient available holdings/i);

    // Selling with no position
    const noPos = validateMarketOrder('sell', 0.1, mockQuote, 50000, null);
    expect(noPos.isValid).toBe(false);
  });

  it('validates limit orders for buy and sell', () => {
    // Limit buy: 0.2 BTC @ 80,000 = $16,000 + fee ~$16,008
    const limitBuy = validateLimitOrder('buy', 0.2, 80000, 50000);
    expect(limitBuy.isValid).toBe(true);
    expect(limitBuy.reservedAmount).toBeGreaterThan(16000);

    // Limit buy exceeding funds
    const excessBuy = validateLimitOrder('buy', 1.0, 80000, 50000);
    expect(excessBuy.isValid).toBe(false);

    // Limit sell within available holding
    const limitSell = validateLimitOrder('sell', 0.8, 85000, 50000, mockPosition);
    expect(limitSell.isValid).toBe(true);
    expect(limitSell.reservedAmount).toBe(0.8);

    // Limit sell exceeding available holding
    const excessSell = validateLimitOrder('sell', 1.1, 85000, 50000, mockPosition);
    expect(excessSell.isValid).toBe(false);
  });

  it('countDecimals accurately counts decimal places for standard and scientific notation', () => {
    expect(countDecimals(0)).toBe(0);
    expect(countDecimals(100)).toBe(0);
    expect(countDecimals(0.1)).toBe(1);
    expect(countDecimals(0.00000001)).toBe(8);
    expect(countDecimals(0.000000001)).toBe(9); // 9 decimals
    expect(countDecimals(1e-9)).toBe(9);
    expect(countDecimals(1e-8)).toBe(8);
    expect(countDecimals(NaN)).toBe(0);
    expect(countDecimals(Infinity)).toBe(0);
  });

  it('getMaxPriceDecimals correctly returns price precision limits based on magnitude', () => {
    expect(getMaxPriceDecimals(90000)).toBe(2);
    expect(getMaxPriceDecimals(1.5)).toBe(2);
    expect(getMaxPriceDecimals(0.5)).toBe(4);
    expect(getMaxPriceDecimals(0.005)).toBe(4);
    expect(getMaxPriceDecimals(0.0001)).toBe(8);
  });

  it('validateOrderBasics rejects quantity exceeding 8 decimal places and accepts up to 8 decimals', () => {
    expect(MAX_QUANTITY_DECIMALS).toBe(8);

    // 9 decimals - must be rejected
    const nineDecimals = validateOrderBasics(0.000000001);
    expect(nineDecimals.isValid).toBe(false);
    expect(nineDecimals.error).toMatch(/cannot exceed 8 decimal places/i);

    // 8 decimals (1 satoshi) - must be accepted
    const eightDecimals = validateOrderBasics(0.00000001);
    expect(eightDecimals.isValid).toBe(true);

    // 4 decimals - accepted
    expect(validateOrderBasics(0.1234).isValid).toBe(true);
  });

  it('validateOrderBasics enforces price precision limits', () => {
    // 2 decimals allowed for price >= 1
    expect(validateOrderBasics(0.1, 90000.55).isValid).toBe(true);

    // 3 decimals for price >= 1 - must be rejected
    const invalidPriceDecimals = validateOrderBasics(0.1, 90000.123);
    expect(invalidPriceDecimals.isValid).toBe(false);
    expect(invalidPriceDecimals.error).toMatch(/cannot exceed 2 decimal places/i);

    // 4 decimals allowed for price 0.05
    expect(validateOrderBasics(100, 0.0525).isValid).toBe(true);
    // 5 decimals for price 0.05 - must be rejected
    expect(validateOrderBasics(100, 0.05255).isValid).toBe(false);
  });

  it('validateOrderBasics rejects extreme overflow values (e.g. 1e30) independently of balances', () => {
    // Extreme quantity (1e30)
    const overflowQty = validateOrderBasics(1e30);
    expect(overflowQty.isValid).toBe(false);
    expect(overflowQty.error).toMatch(/exceeds maximum allowed limit/i);

    // Extreme price (1e30)
    const overflowPrice = validateOrderBasics(1, 1e30);
    expect(overflowPrice.isValid).toBe(false);
    expect(overflowPrice.error).toMatch(/exceeds maximum allowed limit/i);

    // Boundary check
    expect(validateOrderBasics(MAX_SAFE_QUANTITY + 1).isValid).toBe(false);
    expect(validateOrderBasics(1, MAX_SAFE_PRICE + 1).isValid).toBe(false);
    expect(validateOrderBasics(MAX_SAFE_QUANTITY, MAX_SAFE_PRICE).isValid).toBe(true);
  });

  it('enforces minimum $1.00 USDT notional for both limit and market orders', () => {
    expect(MIN_ORDER_NOTIONAL_USDT).toBe(1.0);

    // Limit order with 0.000000001 BTC @ 90,000 USDT -> Notional $0.00009 (< $1.00)
    const subDollarLimit = validateLimitOrder('sell', 0.000000001, 90000, 50000, mockPosition);
    expect(subDollarLimit.isValid).toBe(false);
    // Note: Fails decimal places first, or notional if decimal was 8:
    const subDollar8Dec = validateLimitOrder('sell', 0.00000001, 90000, 50000, mockPosition);
    // 0.00000001 * 90,000 = $0.0009 < $1.00
    expect(subDollar8Dec.isValid).toBe(false);
    expect(subDollar8Dec.error).toMatch(/below the minimum required \$1\.00 USDT/i);

    // Limit order with 0.00001 BTC @ 90,000 USDT -> Notional $0.90 (< $1.00)
    const ninetyCents = validateLimitOrder('buy', 0.00001, 90000, 50000);
    expect(ninetyCents.isValid).toBe(false);
    expect(ninetyCents.error).toMatch(/below the minimum required \$1\.00 USDT/i);

    // Limit order with 0.00002 BTC @ 90,000 USDT -> Notional $1.80 (>= $1.00)
    const validNotional = validateLimitOrder('buy', 0.00002, 90000, 50000);
    expect(validNotional.isValid).toBe(true);

    // Market order below $1.00 notional
    // mockQuote askPrice = 81510. 0.00001 * 81510 = $0.8151 < $1.00
    const subDollarMarket = validateMarketOrder('buy', 0.00001, mockQuote, 50000);
    expect(subDollarMarket.isValid).toBe(false);
    expect(subDollarMarket.error).toMatch(/below the minimum required \$1\.00 USDT/i);

    // Market order with $1.00+ notional
    // 0.0001 * 81510 = $8.151 >= $1.00
    const validMarketNotional = validateMarketOrder('buy', 0.0001, mockQuote, 50000);
    expect(validMarketNotional.isValid).toBe(true);
  });
});
