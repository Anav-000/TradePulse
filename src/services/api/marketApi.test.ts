import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  fetchHistoricalCandles,
  fetch24hrTickers,
  normalizeBinanceRestTickers,
} from './marketApi';
import { useMarketStore } from '@/stores/useMarketStore';

describe('marketApi - REST Market Data & Price Consistency', () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  describe('normalizeBinanceRestTickers', () => {
    it('normalizes valid raw 24hr ticker REST payloads into tickers and book quotes', () => {
      const mockRaw = [
        {
          symbol: 'BTCUSDT',
          priceChange: '-150.50',
          priceChangePercent: '-0.18',
          lastPrice: '82050.00',
          bidPrice: '82049.50',
          askPrice: '82050.50',
          highPrice: '83100.00',
          lowPrice: '81500.00',
          volume: '12500.25',
          quoteVolume: '1025625000.00',
          closeTime: 1729400000000,
        },
        {
          symbol: 'ETHUSDT',
          priceChange: '25.00',
          priceChangePercent: '1.05',
          lastPrice: '2415.00',
          bidPrice: '2414.90',
          askPrice: '2415.10',
          highPrice: '2450.00',
          lowPrice: '2380.00',
          volume: '150000.00',
          quoteVolume: '362250000.00',
          closeTime: 1729400000000,
        },
      ];

      const { tickers, bookQuotes } = normalizeBinanceRestTickers(mockRaw);

      expect(tickers['BTCUSDT']).toBeDefined();
      expect(tickers['BTCUSDT'].lastPrice).toBe(82050.0);
      expect(tickers['BTCUSDT'].priceChange24h).toBe(-150.5);
      expect(tickers['BTCUSDT'].priceChangePercent24h).toBe(-0.18);
      expect(tickers['BTCUSDT'].high24h).toBe(83100.0);
      expect(tickers['BTCUSDT'].low24h).toBe(81500.0);

      expect(bookQuotes['BTCUSDT']).toBeDefined();
      expect(bookQuotes['BTCUSDT'].bidPrice).toBe(82049.5);
      expect(bookQuotes['BTCUSDT'].askPrice).toBe(82050.5);
      expect(bookQuotes['BTCUSDT'].lastPrice).toBe(82050.0);

      expect(tickers['ETHUSDT'].lastPrice).toBe(2415.0);
      expect(bookQuotes['ETHUSDT'].bidPrice).toBe(2414.9);
    });

    it('handles single object response format', () => {
      const singleRaw = {
        symbol: 'SOLUSDT',
        priceChange: '2.50',
        priceChangePercent: '2.40',
        lastPrice: '106.50',
        bidPrice: '106.45',
        askPrice: '106.55',
        highPrice: '109.00',
        lowPrice: '103.00',
        volume: '500000.00',
        quoteVolume: '53250000.00',
        closeTime: 1729400000000,
      };

      const { tickers, bookQuotes } = normalizeBinanceRestTickers(singleRaw);
      expect(tickers['SOLUSDT']).toBeDefined();
      expect(tickers['SOLUSDT'].lastPrice).toBe(106.5);
      expect(bookQuotes['SOLUSDT'].bidPrice).toBe(106.45);
      expect(bookQuotes['SOLUSDT'].askPrice).toBe(106.55);
    });

    it('filters out invalid, corrupted, or non-finite entries safely', () => {
      const corruptRaw = [
        null,
        undefined,
        {},
        { symbol: 'BAD1', lastPrice: 'NaN', priceChangePercent: '0' },
        { symbol: 'BAD2', lastPrice: '-500', priceChangePercent: '0' },
        { symbol: 'BAD3', lastPrice: '0', priceChangePercent: '0' },
        { symbol: 'BAD4', lastPrice: 'Infinity', priceChangePercent: '0' },
        {
          symbol: 'VALID',
          lastPrice: '50.0',
          priceChangePercent: '1.2',
          bidPrice: '0', // invalid bid
          askPrice: '50.1',
        },
      ];

      const { tickers, bookQuotes } = normalizeBinanceRestTickers(corruptRaw);
      expect(Object.keys(tickers)).toEqual(['VALID']);
      expect(tickers['VALID'].lastPrice).toBe(50.0);
      // bookQuote requires both bidPrice > 0 and askPrice > 0
      expect(bookQuotes['VALID']).toBeUndefined();
    });
  });

  describe('fetch24hrTickers', () => {
    it('fetches and normalizes tickers from Binance Public API successfully', async () => {
      const mockApiResponse = [
        {
          symbol: 'BTCUSDT',
          priceChange: '120.00',
          priceChangePercent: '0.15',
          lastPrice: '82150.00',
          bidPrice: '82149.00',
          askPrice: '82151.00',
          highPrice: '83000.00',
          lowPrice: '81000.00',
          volume: '15000.00',
          quoteVolume: '1232250000.00',
          closeTime: 1729400000000,
        },
      ];

      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(mockApiResponse),
      });

      const result = await fetch24hrTickers(['BTCUSDT']);

      expect(result.source).toBe('Binance Public API');
      expect(result.tickers['BTCUSDT'].lastPrice).toBe(82150.0);
      expect(result.bookQuotes['BTCUSDT'].bidPrice).toBe(82149.0);
      expect(result.bookQuotes['BTCUSDT'].askPrice).toBe(82151.0);
    });

    it('fails over to Binance Vision API if primary endpoint fails', async () => {
      const mockVisionResponse = [
        {
          symbol: 'BTCUSDT',
          priceChange: '120.00',
          priceChangePercent: '0.15',
          lastPrice: '82150.00',
          bidPrice: '82149.00',
          askPrice: '82151.00',
          highPrice: '83000.00',
          lowPrice: '81000.00',
          volume: '15000.00',
          quoteVolume: '1232250000.00',
          closeTime: 1729400000000,
        },
      ];

      let callCount = 0;
      global.fetch = vi.fn().mockImplementation((url: string) => {
        callCount++;
        if (url.includes('api.binance.com')) {
          return Promise.resolve({
            ok: false,
            status: 503,
            statusText: 'Service Unavailable',
          });
        }
        if (url.includes('data-api.binance.vision')) {
          return Promise.resolve({
            ok: true,
            json: () => Promise.resolve(mockVisionResponse),
          });
        }
        return Promise.reject(new Error('Unknown URL'));
      });

      const result = await fetch24hrTickers(['BTCUSDT']);

      expect(callCount).toBe(2);
      expect(result.source).toBe('Binance Vision API');
      expect(result.tickers['BTCUSDT'].lastPrice).toBe(82150.0);
    });

    it('throws meaningful error if all endpoints fail without faking data', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 500,
        statusText: 'Internal Server Error',
      });

      await expect(fetch24hrTickers(['BTCUSDT'])).rejects.toThrow(
        /Failed to fetch real 24hr tickers/
      );
    });

    it('returns empty maps when empty symbols array is provided', async () => {
      const result = await fetch24hrTickers([]);
      expect(result.tickers).toEqual({});
      expect(result.bookQuotes).toEqual({});
    });
  });

  describe('fetchHistoricalCandles', () => {
    it('fails over to Binance Vision API when primary endpoint encounters network error', async () => {
      const mockKlines = [
        [1729382400000, '81500.0', '82200.0', '81400.0', '82086.0', '150.5', 1729386000000, '1234567.8'],
      ];

      global.fetch = vi.fn().mockImplementation((url: string) => {
        if (url.includes('api.binance.com')) {
          return Promise.reject(new Error('Failed to fetch (CORS/Network error)'));
        }
        if (url.includes('data-api.binance.vision')) {
          return Promise.resolve({
            ok: true,
            json: () => Promise.resolve(mockKlines),
          });
        }
        return Promise.reject(new Error('Unknown URL'));
      });

      const result = await fetchHistoricalCandles('BTCUSDT', '1h');
      expect(result.source).toBe('Binance Vision API');
      expect(result.candles.length).toBe(1);
      expect(result.candles[0].close).toBe(82086.0);
    });
  });

  describe('Price-Source Consistency & Stale Data Guard', () => {
    it('NEVER overwrites a fresh verified WebSocket or REST ticker with historical candle data', () => {
      const now = Date.now();
      // Set BTC ticker to a fresh live WebSocket price (82,500.00) updated 5 seconds ago
      useMarketStore.setState((state) => ({
        tickers: state.tickers.map((t) =>
          t.symbol === 'BTCUSDT'
            ? {
                ...t,
                lastPrice: 82500.0,
                lastUpdated: now - 5000,
                source: 'websocket' as const,
              }
            : t
        ),
      }));

      // An older or divergent historical candle arrives with close = 82,000.00
      useMarketStore.getState().syncTickerPrice('BTCUSDT', 82000.0, {
        candleTimestamp: now - 3600000,
        fetchTime: now,
      });

      // The live fresh ticker price MUST NOT be overwritten
      const btcTicker = useMarketStore.getState().tickers.find((t) => t.symbol === 'BTCUSDT');
      expect(btcTicker?.lastPrice).toBe(82500.0);
      expect(btcTicker?.source).toBe('websocket');
    });

    it('synchronizes ticker price when ticker is unverified mock or stale', () => {
      // Set BTC ticker to mock baseline (e.g. 67,842.50)
      useMarketStore.setState((state) => ({
        tickers: state.tickers.map((t) =>
          t.symbol === 'BTCUSDT'
            ? {
                ...t,
                lastPrice: 67842.5,
                source: 'mock' as const,
                lastUpdated: 0,
              }
            : t
        ),
      }));

      expect(useMarketStore.getState().tickers.find((t) => t.symbol === 'BTCUSDT')?.lastPrice).toBe(
        67842.5
      );

      // Verified candle arrives with close = 82,086.00
      const now = Date.now();
      useMarketStore.getState().syncTickerPrice('BTCUSDT', 82086.0, {
        candleTimestamp: now - 60000,
        fetchTime: now,
      });

      const btcTicker = useMarketStore.getState().tickers.find((t) => t.symbol === 'BTCUSDT');
      expect(btcTicker?.lastPrice).toBe(82086.0);
      expect(btcTicker?.source).toBe('candle_sync');
    });

    it('ignores small fluctuations (<0.1%) between verified sources to avoid jitter', () => {
      const now = Date.now();
      useMarketStore.setState((state) => ({
        tickers: state.tickers.map((t) =>
          t.symbol === 'BTCUSDT'
            ? {
                ...t,
                lastPrice: 82000.0,
                source: 'candle_sync' as const,
                lastUpdated: now - 70000, // slightly older than 60s
              }
            : t
        ),
      }));

      // Difference is only 0.05% (< 0.1%)
      useMarketStore.getState().syncTickerPrice('BTCUSDT', 82040.0, {
        candleTimestamp: now - 10000,
        fetchTime: now,
      });

      // Price should remain 82000.0
      expect(useMarketStore.getState().tickers.find((t) => t.symbol === 'BTCUSDT')?.lastPrice).toBe(
        82000.0
      );
    });

    it('safely rejects invalid, zero, or negative candle prices', () => {
      useMarketStore.setState((state) => ({
        tickers: state.tickers.map((t) =>
          t.symbol === 'BTCUSDT' ? { ...t, lastPrice: 82000.0 } : t
        ),
      }));

      useMarketStore.getState().syncTickerPrice('BTCUSDT', -500);
      useMarketStore.getState().syncTickerPrice('BTCUSDT', 0);
      useMarketStore.getState().syncTickerPrice('BTCUSDT', NaN);
      useMarketStore.getState().syncTickerPrice('BTCUSDT', Infinity);

      expect(useMarketStore.getState().tickers.find((t) => t.symbol === 'BTCUSDT')?.lastPrice).toBe(
        82000.0
      );
    });
  });
});
