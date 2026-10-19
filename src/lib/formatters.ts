/**
 * Financial formatters for TradePulse terminal
 */

/**
 * Formats a number as USD currency with adaptive decimal precision based on magnitude.
 */
export function formatCurrency(value: number, currency: string = 'USD'): string {
  if (!Number.isFinite(value) || value === 0) return '$0.00';
  
  const absValue = Math.abs(value);
  let minimumFractionDigits = 2;
  let maximumFractionDigits = 2;

  if (absValue < 0.0001) {
    minimumFractionDigits = 6;
    maximumFractionDigits = 8;
  } else if (absValue < 1) {
    minimumFractionDigits = 4;
    maximumFractionDigits = 4;
  }

  const formatted = new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency,
    minimumFractionDigits,
    maximumFractionDigits,
  }).format(absValue);

  return value < 0 ? `-${formatted}` : formatted;
}

/**
 * Formats a percentage with leading sign (+ / -).
 */
export function formatPercentage(value: number): string {
  if (!Number.isFinite(value)) return '0.00%';
  const prefix = value > 0 ? '+' : '';
  return `${prefix}${value.toFixed(2)}%`;
}

/**
 * Formats large volumes with compact suffixes (K, M, B, T).
 */
export function formatCompactNumber(value: number): string {
  if (!Number.isFinite(value)) return '0';
  return new Intl.NumberFormat('en-US', {
    notation: 'compact',
    compactDisplay: 'short',
    maximumFractionDigits: 2,
  }).format(value);
}

/**
 * Formats large currency volume (e.g., $1.24B)
 */
export function formatCompactCurrency(value: number): string {
  return `$${formatCompactNumber(value)}`;
}

/**
 * Formats raw crypto amount with appropriate precision.
 */
export function formatCryptoAmount(amount: number, symbol?: string): string {
  if (!Number.isFinite(amount)) return symbol ? `0.00 ${symbol}` : '0.00';
  const formatted = new Intl.NumberFormat('en-US', {
    maximumFractionDigits: 6,
    minimumFractionDigits: 2,
  }).format(amount);
  return symbol ? `${formatted} ${symbol}` : formatted;
}

/**
 * Formats order book quantities adaptively so small nonzero amounts are never rounded to 0.000.
 */
export function formatOrderBookQuantity(qty: number): string {
  if (!Number.isFinite(qty) || qty === 0) return '0.00';

  const absQty = Math.abs(qty);

  if (absQty < 0.0001) {
    // Micro quantities (e.g. 0.000045) -> 6 decimal places
    return qty.toFixed(6);
  }
  if (absQty < 0.01) {
    // Small quantities (e.g. 0.0045) -> 5 decimal places
    return qty.toFixed(5);
  }
  if (absQty < 1) {
    // Sub-unit quantities (e.g. 0.4500) -> 4 decimal places
    return qty.toFixed(4);
  }
  if (absQty < 100) {
    return qty.toFixed(3);
  }
  if (absQty < 10000) {
    return qty.toFixed(2);
  }
  return formatCompactNumber(qty);
}

/**
 * Formats timestamp to terminal time (HH:mm:ss or MM/DD HH:mm).
 */
export function formatTerminalTime(timestamp: number | Date): string {
  const date = typeof timestamp === 'number' ? new Date(timestamp) : timestamp;
  return date.toLocaleTimeString('en-US', {
    hour12: false,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}
