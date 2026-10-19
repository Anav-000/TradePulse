import { CryptoTicker } from '@/types/market';

export interface MarketRankingsResult {
  topPerformers: CryptoTicker[];
  bottomPerformers: CryptoTicker[];
  gainers: CryptoTicker[];
  losers: CryptoTicker[];
}

/**
 * Classifies and ranks cryptocurrency tickers based on 24-hour percentage performance.
 *
 * Rules:
 * 1. Filter out missing, NaN, or non-finite percentage values.
 * 2. Stable algebraic sort:
 *    - Top Performers: Descending by priceChangePercent24h (highest algebraic return first). Tiebreak: symbol alphabetically.
 *    - Bottom Performers: Ascending by priceChangePercent24h (lowest algebraic return first). Tiebreak: symbol alphabetically.
 * 3. Gainers: Strictly positive (priceChangePercent24h > 0).
 * 4. Losers: Strictly negative (priceChangePercent24h < 0).
 * 5. Zero-change assets (=== 0) are excluded from strict Gainers and Losers.
 * 6. Never uses absolute values for sorting.
 */
export function classifyAndRankMarketTickers(
  tickers: CryptoTicker[],
  limit = 3
): MarketRankingsResult {
  if (!Array.isArray(tickers) || tickers.length === 0) {
    return {
      topPerformers: [],
      bottomPerformers: [],
      gainers: [],
      losers: [],
    };
  }

  // 1. Sanitize and validate numeric values
  const validTickers = tickers.filter(
    (t) =>
      t &&
      typeof t.symbol === 'string' &&
      typeof t.priceChangePercent24h === 'number' &&
      Number.isFinite(t.priceChangePercent24h) &&
      !isNaN(t.priceChangePercent24h)
  );

  // 2. Stable sort helper: primary by numeric change, secondary by symbol string
  const sortDescending = (a: CryptoTicker, b: CryptoTicker) => {
    if (b.priceChangePercent24h !== a.priceChangePercent24h) {
      return b.priceChangePercent24h - a.priceChangePercent24h;
    }
    return a.symbol.localeCompare(b.symbol);
  };

  const sortAscending = (a: CryptoTicker, b: CryptoTicker) => {
    if (a.priceChangePercent24h !== b.priceChangePercent24h) {
      return a.priceChangePercent24h - b.priceChangePercent24h;
    }
    return a.symbol.localeCompare(b.symbol);
  };

  // 3. Top Performers (relative best, even if negative in market crash)
  const topPerformers = [...validTickers].sort(sortDescending).slice(0, limit);

  // 4. Bottom Performers (relative worst, even if positive in bull run)
  const bottomPerformers = [...validTickers].sort(sortAscending).slice(0, limit);

  // 5. Strict Gainers (> 0)
  const gainers = validTickers.filter((t) => t.priceChangePercent24h > 0).sort(sortDescending);

  // 6. Strict Losers (< 0)
  const losers = validTickers.filter((t) => t.priceChangePercent24h < 0).sort(sortAscending);

  return {
    topPerformers,
    bottomPerformers,
    gainers,
    losers,
  };
}
