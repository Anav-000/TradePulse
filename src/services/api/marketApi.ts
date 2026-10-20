import { CandleStick, TimeFrame } from '@/types/market';
import {
  normalizeBinanceKlines,
  timeframeToBinanceInterval,
} from './candleNormalizer';
import { NormalizedTickerUpdate, BookQuote } from '@/services/websocket/types';

export interface HistoricalCandlesResult {
  candles: CandleStick[];
  source: string;
  lastUpdated: number;
}

export interface RestTickersResult {
  tickers: Record<string, NormalizedTickerUpdate>;
  bookQuotes: Record<string, BookQuote>;
  source: string;
  lastUpdated: number;
}

/**
 * Public REST endpoints with fallback redundancy
 */
const ENDPOINTS = [
  {
    name: 'Binance Public API',
    buildKlineUrl: (symbol: string, interval: string) =>
      `https://api.binance.com/api/v3/klines?symbol=${encodeURIComponent(
        symbol
      )}&interval=${interval}&limit=300`,
    buildTickersUrl: (symbols: string[]) =>
      `https://api.binance.com/api/v3/ticker/24hr?symbols=${encodeURIComponent(
        JSON.stringify(symbols.map((s) => s.toUpperCase()))
      )}`,
  },
  {
    name: 'Binance Vision API',
    buildKlineUrl: (symbol: string, interval: string) =>
      `https://data-api.binance.vision/api/v3/klines?symbol=${encodeURIComponent(
        symbol
      )}&interval=${interval}&limit=300`,
    buildTickersUrl: (symbols: string[]) =>
      `https://data-api.binance.vision/api/v3/ticker/24hr?symbols=${encodeURIComponent(
        JSON.stringify(symbols.map((s) => s.toUpperCase()))
      )}`,
  },
];

/**
 * Normalizes raw Binance REST 24hr ticker payloads.
 * Extracts validated tickers and best bid/ask book quotes.
 */
export function normalizeBinanceRestTickers(rawData: unknown): {
  tickers: Record<string, NormalizedTickerUpdate>;
  bookQuotes: Record<string, BookQuote>;
} {
  const tickers: Record<string, NormalizedTickerUpdate> = {};
  const bookQuotes: Record<string, BookQuote> = {};

  const list = Array.isArray(rawData)
    ? rawData
    : rawData && typeof rawData === 'object'
    ? [rawData]
    : [];

  for (const item of list) {
    if (!item || typeof item !== 'object') continue;
    const raw = item as Record<string, unknown>;
    const symbol = String(raw.symbol || '').toUpperCase();
    if (!symbol) continue;

    const lastPrice = parseFloat(String(raw.lastPrice || '0'));
    const priceChange24h = parseFloat(String(raw.priceChange || '0'));
    const priceChangePercent24h = parseFloat(String(raw.priceChangePercent || '0'));
    const high24h = parseFloat(String(raw.highPrice || '0'));
    const low24h = parseFloat(String(raw.lowPrice || '0'));
    const volume24h = parseFloat(String(raw.volume || '0'));
    const quoteVolume24h = parseFloat(String(raw.quoteVolume || '0'));
    const bidPrice = parseFloat(String(raw.bidPrice || '0'));
    const askPrice = parseFloat(String(raw.askPrice || '0'));
    const timestamp = Number(raw.closeTime) || Date.now();

    if (
      !Number.isFinite(lastPrice) ||
      lastPrice <= 0 ||
      !Number.isFinite(priceChangePercent24h)
    ) {
      continue;
    }

    tickers[symbol] = {
      symbol,
      lastPrice,
      priceChange24h,
      priceChangePercent24h,
      high24h,
      low24h,
      volume24h,
      quoteVolume24h,
      timestamp,
    };

    if (bidPrice > 0 && askPrice > 0) {
      bookQuotes[symbol] = {
        symbol,
        bidPrice,
        askPrice,
        lastPrice,
        timestamp,
      };
    }
  }

  return { tickers, bookQuotes };
}

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
      const url = endpoint.buildKlineUrl(symbol, interval);
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
        throw new Error(
          `${endpoint.name} returned no valid candlestick data for ${symbol}`
        );
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

/**
 * Fetches real 24hr ticker statistics and quotes across redundant exchange endpoints.
 * Hydrates stores immediately on mount and provides resilient fallback when WebSocket
 * connections are delayed, blocked, or reconnecting.
 */
export async function fetch24hrTickers(
  symbols: string[],
  signal?: AbortSignal
): Promise<RestTickersResult> {
  if (!symbols || symbols.length === 0) {
    return {
      tickers: {},
      bookQuotes: {},
      source: 'Binance Public API',
      lastUpdated: Date.now(),
    };
  }

  let lastError: Error | null = null;

  for (const endpoint of ENDPOINTS) {
    if (signal?.aborted) {
      throw new DOMException('Request aborted by user/component', 'AbortError');
    }

    try {
      const url = endpoint.buildTickersUrl(symbols);
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
      const { tickers, bookQuotes } = normalizeBinanceRestTickers(rawData);

      if (Object.keys(tickers).length === 0) {
        throw new Error(`${endpoint.name} returned no valid 24hr ticker data`);
      }

      return {
        tickers,
        bookQuotes,
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

  throw new Error(
    `Failed to fetch real 24hr tickers for [${symbols.join(', ')}]. ${
      lastError ? lastError.message : 'Public endpoints unreachable.'
    }`
  );
}
