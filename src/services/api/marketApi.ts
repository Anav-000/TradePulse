import { CandleStick, TimeFrame } from '@/types/market';
import {
  normalizeBinanceKlines,
  timeframeToBinanceInterval,
} from './candleNormalizer';

export interface HistoricalCandlesResult {
  candles: CandleStick[];
  source: string;
  lastUpdated: number;
}

/**
 * Public REST endpoints with fallback redundancy
 */
const ENDPOINTS = [
  {
    name: 'Binance Public API',
    buildUrl: (symbol: string, interval: string) =>
      `https://api.binance.com/api/v3/klines?symbol=${encodeURIComponent(
        symbol
      )}&interval=${interval}&limit=300`,
  },
  {
    name: 'Binance Vision API',
    buildUrl: (symbol: string, interval: string) =>
      `https://data-api.binance.vision/api/v3/klines?symbol=${encodeURIComponent(
        symbol
      )}&interval=${interval}&limit=300`,
  },
];

/**
 * Fetches real historical candlestick data across redundant public exchange endpoints.
 * Throws a clear error if all endpoints fail to ensure no simulated data is presented as real.
 */
export async function fetchHistoricalCandles(
  symbol: string,
  timeFrame: TimeFrame,
  signal?: AbortSignal
): Promise<HistoricalCandlesResult> {
  const interval = timeframeToBinanceInterval(timeFrame);
  let lastError: Error | null = null;

  for (const endpoint of ENDPOINTS) {
    if (signal?.aborted) {
      throw new DOMException('Request aborted by user/component', 'AbortError');
    }

    try {
      const url = endpoint.buildUrl(symbol, interval);
      const response = await fetch(url, {
        signal,
        headers: {
          Accept: 'application/json',
        },
      });

      if (!response.ok) {
        throw new Error(
          `${endpoint.name} returned HTTP ${response.status}: ${response.statusText}`
        );
      }

      const rawData = await response.json();
      const normalizedCandles = normalizeBinanceKlines(rawData);

      if (normalizedCandles.length === 0) {
        throw new Error(`${endpoint.name} returned no valid candlestick data for ${symbol}`);
      }

      return {
        candles: normalizedCandles,
        source: endpoint.name,
        lastUpdated: Date.now(),
      };
    } catch (err: unknown) {
      if (err instanceof DOMException && err.name === 'AbortError') {
        throw err;
      }

      lastError = err instanceof Error ? err : new Error(String(err));
      // Continue to next fallback endpoint
    }
  }

  // If all public endpoints fail, fail honestly with meaningful context
  throw new Error(
    `Failed to fetch real market data for ${symbol} (${timeFrame}). ${
      lastError ? lastError.message : 'Public endpoints unreachable.'
    }`
  );
}
