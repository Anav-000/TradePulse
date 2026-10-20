import { create } from 'zustand';
import {
  CryptoTicker,
  MarketOverviewStats,
  TimeFrame,
  ConnectionStatus,
  OrderBookData,
} from '@/types/market';
import { MOCK_TICKERS, MOCK_MARKET_OVERVIEW } from '@/lib/sample-data';
import { wsManager } from '@/services/websocket/BinanceWebSocketManager';
import { NormalizedTickerUpdate } from '@/services/websocket/types';

interface MarketState {
  tickers: CryptoTicker[];
  overview: MarketOverviewStats;
  globalStatsSource: string;
  globalStatsLastUpdated: number | null;
  globalStatsStatus: 'live' | 'stale' | 'unavailable';
  selectedSymbol: string;
  timeFrame: TimeFrame;
  searchQuery: string;
  categoryFilter: 'all' | 'gainers' | 'losers' | 'favorites';
  connectionStatus: ConnectionStatus;
  latencyMs: number;
  orderBook: OrderBookData | null;
  
  // Actions
  setSelectedSymbol: (symbol: string) => void;
  setTimeFrame: (tf: TimeFrame) => void;
  setSearchQuery: (query: string) => void;
  setCategoryFilter: (filter: 'all' | 'gainers' | 'losers' | 'favorites') => void;
  toggleFavorite: (symbol: string) => void;
  getSelectedTicker: () => CryptoTicker;
  updateTickersBatch: (
    batch: Record<string, NormalizedTickerUpdate>,
    source?: 'websocket' | 'rest'
  ) => void;
  setOrderBook: (data: OrderBookData) => void;
  setConnectionStatus: (status: ConnectionStatus, latencyMs?: number) => void;
  setGlobalOverview: (
    stats: MarketOverviewStats,
    source: string,
    status: 'live' | 'stale' | 'unavailable'
  ) => void;
  updateSparklines: (sparklines: Record<string, { prices: number[]; changePercent7d: number }>) => void;
  syncTickerPrice: (
    symbol: string,
    candleClosePrice: number,
    options?: { candleTimestamp?: number; fetchTime?: number }
  ) => void;
}

export const useMarketStore = create<MarketState>((set, get) => ({
  tickers: MOCK_TICKERS,
  overview: MOCK_MARKET_OVERVIEW,
  globalStatsSource: 'CoinPaprika & Alternative.me Public APIs',
  globalStatsLastUpdated: null,
  globalStatsStatus: 'live',
  selectedSymbol: 'BTCUSDT',
  timeFrame: '1h',
  searchQuery: '',
  categoryFilter: 'all',
  connectionStatus: 'connecting',
  latencyMs: 24,
  orderBook: null,

  setSelectedSymbol: (symbol) => {
    const s = symbol.toUpperCase();
    set({ selectedSymbol: s });
    wsManager.setActiveSubscription(s, get().timeFrame);
  },

  setTimeFrame: (timeFrame) => {
    set({ timeFrame });
    wsManager.setActiveSubscription(get().selectedSymbol, timeFrame);
  },

  setSearchQuery: (searchQuery) => set({ searchQuery }),
  setCategoryFilter: (categoryFilter) => set({ categoryFilter }),
  
  toggleFavorite: (symbol) => {
    set((state) => ({
      tickers: state.tickers.map((t) =>
        t.symbol === symbol ? { ...t, isFavorite: !t.isFavorite } : t
      ),
    }));
  },

  getSelectedTicker: () => {
    const state = get();
    return state.tickers.find((t) => t.symbol === state.selectedSymbol) || state.tickers[0];
  },

  updateTickersBatch: (batch, source = 'websocket') => {
    set((state) => {
      let hasChanges = false;
      const updatedTickers = state.tickers.map((t) => {
        const update = batch[t.symbol];
        if (!update) return t;

        hasChanges = true;
        return {
          ...t,
          lastPrice: update.lastPrice,
          priceChange24h: update.priceChange24h,
          priceChangePercent24h: update.priceChangePercent24h,
          high24h: update.high24h,
          low24h: update.low24h,
          volume24h: update.volume24h,
          quoteVolume24h: update.quoteVolume24h,
          lastUpdated: update.timestamp || Date.now(),
          source: source,
        };
      });

      if (!hasChanges) return state;

      return { tickers: updatedTickers };
    });
  },

  setOrderBook: (orderBook) => set({ orderBook }),

  setConnectionStatus: (connectionStatus, latencyMs) =>
    set((state) => ({
      connectionStatus,
      latencyMs: latencyMs !== undefined ? latencyMs : state.latencyMs,
    })),

  setGlobalOverview: (overview, globalStatsSource, globalStatsStatus) =>
    set({
      overview,
      globalStatsSource,
      globalStatsStatus,
      globalStatsLastUpdated: Date.now(),
    }),

  updateSparklines: (sparklines) => {
    set((state) => ({
      tickers: state.tickers.map((t) => {
        const spark = sparklines[t.symbol];
        if (!spark || spark.prices.length === 0) return t;
        return {
          ...t,
          sparkline7d: spark.prices,
        };
      }),
    }));
  },

  syncTickerPrice: (symbol, candleClosePrice, options) => {
    if (!Number.isFinite(candleClosePrice) || candleClosePrice <= 0) return;
    const targetSymbol = symbol.toUpperCase();

    set((state) => {
      const existing = state.tickers.find((t) => t.symbol === targetSymbol);
      if (!existing) return state;

      const now = Date.now();
      const candleTime = options?.candleTimestamp || 0;
      const fetchTime = options?.fetchTime || now;

      // 1. Freshness & Source Protection:
      // If the ticker was updated by a live stream (WebSocket or REST) and that data is fresh
      // (within the last 60 seconds, or newer than the candle's close time), NEVER overwrite it with historical candle data.
      const isLiveSource = existing.source === 'websocket' || existing.source === 'rest';
      const tickerAgeMs = existing.lastUpdated ? now - existing.lastUpdated : Infinity;
      const isFreshLive = isLiveSource && tickerAgeMs < 60000;
      const isNewerThanCandle = Boolean(existing.lastUpdated && candleTime && existing.lastUpdated >= candleTime);

      if (isFreshLive || isNewerThanCandle) {
        return state;
      }

      // 2. Jitter suppression if both are already aligned within 0.1% (unless ticker is still unverified mock)
      const diffPercent = Math.abs(existing.lastPrice - candleClosePrice) / candleClosePrice;
      if (diffPercent < 0.001 && existing.source !== 'mock') {
        return state;
      }

      return {
        tickers: state.tickers.map((t) =>
          t.symbol === targetSymbol
            ? {
                ...t,
                lastPrice: candleClosePrice,
                lastUpdated: fetchTime,
                source: 'candle_sync',
              }
            : t
        ),
      };
    });
  },
}));
