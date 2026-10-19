import Decimal from 'decimal.js';
import { OrderSide, LiveQuote, Position } from '../types';
import { calculateTotalBuyCost, DEFAULT_FEE_RATE } from './feeCalculator';

export interface ValidationResult {
  isValid: boolean;
  error?: string;
}

export const MAX_QUOTE_AGE_MS = 60_000; // 60 seconds max age for execution quotes
export const MAX_QUANTITY_DECIMALS = 8;  // Standard Bitcoin/crypto maximum 8 decimal places
export const MIN_ORDER_NOTIONAL_USDT = 1.0; // Minimum 1.00 USDT order value
export const MAX_SAFE_QUANTITY = 1_000_000; // Safe upper bound to prevent numeric overflow
export const MAX_SAFE_PRICE = 10_000_000;   // Safe upper bound to prevent numeric overflow

/**
 * Counts the exact number of decimal places of a finite number.
 */
export function countDecimals(value: number): number {
  if (!Number.isFinite(value) || isNaN(value)) return 0;
  try {
    return new Decimal(value).decimalPlaces();
  } catch {
    return 0;
  }
}

/**
 * Determines the maximum allowed decimal places for a quote price based on asset magnitude.
 * Matches standard exchange / TradePulse convention.
 */
export function getMaxPriceDecimals(price: number): number {
  if (price >= 1) return 2;
  if (price >= 0.001) return 4;
  return 8;
}

/**
 * Validates fundamental order inputs (quantity & price).
 */
export function validateOrderBasics(quantity: number, price?: number): ValidationResult {
  if (!Number.isFinite(quantity) || isNaN(quantity) || quantity <= 0) {
    return { isValid: false, error: 'Order quantity must be a positive number greater than 0.' };
  }

  if (quantity > MAX_SAFE_QUANTITY) {
    return { isValid: false, error: `Order quantity exceeds maximum allowed limit of ${MAX_SAFE_QUANTITY.toLocaleString()}.` };
  }

  if (countDecimals(quantity) > MAX_QUANTITY_DECIMALS) {
    return { isValid: false, error: `Order quantity cannot exceed ${MAX_QUANTITY_DECIMALS} decimal places.` };
  }

  if (price !== undefined) {
    if (!Number.isFinite(price) || isNaN(price) || price <= 0) {
      return { isValid: false, error: 'Order price must be a positive number greater than 0.' };
    }

    if (price > MAX_SAFE_PRICE) {
      return { isValid: false, error: `Order price exceeds maximum allowed limit of $${MAX_SAFE_PRICE.toLocaleString()}.` };
    }

    const maxPriceDecimals = getMaxPriceDecimals(price);
    if (countDecimals(price) > maxPriceDecimals) {
      return { isValid: false, error: `Order price cannot exceed ${maxPriceDecimals} decimal places for this asset.` };
    }
  }

  return { isValid: true };
}

/**
 * Pure predicate to verify if a market quote is fresh, non-zero, and finite.
 */
export function isQuoteFresh(quote: LiveQuote | null | undefined, now: number = Date.now()): boolean {
  if (!quote) return false;
  if (!Number.isFinite(quote.bidPrice) || quote.bidPrice <= 0) return false;
  if (!Number.isFinite(quote.askPrice) || quote.askPrice <= 0) return false;
  if (!quote.timestamp || !Number.isFinite(quote.timestamp) || quote.timestamp <= 0) return false;
  if (now - quote.timestamp > MAX_QUOTE_AGE_MS) return false;
  return true;
}

/**
 * Validates whether a live quote is executable (not stale, zero, or missing).
 */
export function validateQuoteFreshness(
  quote: LiveQuote | null | undefined,
  side: OrderSide,
  now: number = Date.now()
): { isValid: boolean; executablePrice: number; error?: string } {
  if (!quote) {
    return { isValid: false, executablePrice: 0, error: 'Market data is unavailable. Please wait for live connection.' };
  }

  const quotePrice = side === 'buy' ? quote.askPrice : quote.bidPrice;
  const quoteLabel = side === 'buy' ? 'Ask' : 'Bid';

  if (!Number.isFinite(quotePrice) || quotePrice <= 0) {
    return { isValid: false, executablePrice: 0, error: `Valid live ${quoteLabel} quote is currently unavailable.` };
  }

  if (!quote.timestamp || !Number.isFinite(quote.timestamp) || quote.timestamp <= 0 || now - quote.timestamp > MAX_QUOTE_AGE_MS) {
    return { isValid: false, executablePrice: 0, error: 'Market data quote is stale. Orders cannot be executed.' };
  }

  return { isValid: true, executablePrice: quotePrice };
}

/**
 * Validates a Market Order against live quotes and available virtual balances.
 */
export function validateMarketOrder(
  side: OrderSide,
  quantity: number,
  quote: LiveQuote | null | undefined,
  availableUsdt: number,
  currentPosition?: Position | null,
  feeRate: number = DEFAULT_FEE_RATE,
  now: number = Date.now()
): ValidationResult & { executablePrice?: number; totalCost?: number } {
  const basics = validateOrderBasics(quantity);
  if (!basics.isValid) return basics;

  const quoteValidation = validateQuoteFreshness(quote, side, now);
  if (!quoteValidation.isValid) {
    return { isValid: false, error: quoteValidation.error };
  }

  const price = quoteValidation.executablePrice;

  // Minimum notional enforcement
  const notional = price * quantity;
  if (notional < MIN_ORDER_NOTIONAL_USDT) {
    return {
      isValid: false,
      error: `Order notional ($${notional.toFixed(4)}) is below the minimum required $${MIN_ORDER_NOTIONAL_USDT.toFixed(2)} USDT.`,
    };
  }

  if (side === 'buy') {
    const totalCost = calculateTotalBuyCost(price, quantity, feeRate);
    if (totalCost > availableUsdt) {
      return {
        isValid: false,
        error: `Insufficient available USDT balance. Required: $${totalCost.toFixed(2)}, Available: $${availableUsdt.toFixed(2)}.`,
      };
    }
    return { isValid: true, executablePrice: price, totalCost };
  } else {
    const availableQty = currentPosition ? currentPosition.availableQuantity : 0;
    if (quantity > availableQty) {
      return {
        isValid: false,
        error: `Insufficient available holdings. Requested: ${quantity}, Available: ${availableQty.toFixed(6)}.`,
      };
    }
    return { isValid: true, executablePrice: price };
  }
}

/**
 * Validates a Limit Order against specified limit price and available virtual balances.
 */
export function validateLimitOrder(
  side: OrderSide,
  quantity: number,
  limitPrice: number,
  availableUsdt: number,
  currentPosition?: Position | null,
  feeRate: number = DEFAULT_FEE_RATE
): ValidationResult & { reservedAmount?: number } {
  const basics = validateOrderBasics(quantity, limitPrice);
  if (!basics.isValid) return basics;

  // Minimum notional enforcement
  const notional = limitPrice * quantity;
  if (notional < MIN_ORDER_NOTIONAL_USDT) {
    return {
      isValid: false,
      error: `Order notional ($${notional.toFixed(4)}) is below the minimum required $${MIN_ORDER_NOTIONAL_USDT.toFixed(2)} USDT.`,
    };
  }

  if (side === 'buy') {
    const maxRequired = calculateTotalBuyCost(limitPrice, quantity, feeRate);
    if (maxRequired > availableUsdt) {
      return {
        isValid: false,
        error: `Insufficient available USDT for limit order. Required: $${maxRequired.toFixed(2)}, Available: $${availableUsdt.toFixed(2)}.`,
      };
    }
    return { isValid: true, reservedAmount: maxRequired };
  } else {
    const availableQty = currentPosition ? currentPosition.availableQuantity : 0;
    if (quantity > availableQty) {
      return {
        isValid: false,
        error: `Insufficient available holdings for limit order. Requested: ${quantity}, Available: ${availableQty.toFixed(6)}.`,
      };
    }
    return { isValid: true, reservedAmount: quantity };
  }
}
