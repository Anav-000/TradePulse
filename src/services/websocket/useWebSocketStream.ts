import { useEffect } from 'react';
import { useMarketStore } from '@/stores/useMarketStore';
import { useTradingStore } from '@/features/trading/stores/useTradingStore';
import { LiveQuote } from '@/features/trading/types';
import { wsManager } from './BinanceWebSocketManager';

/**
 * Initializes and manages the singleton Binance WebSocket stream connection,
 * binding high-frequency events to the Zustand store with batched dispatch,
 * and evaluating pending simulated limit orders against fresh market quotes
 * across all monitored cryptocurrency pairs.
 */
export function useWebSocketStream() {
  const selectedSymbol = useMarketStore((s) => s.selectedSymbol);
  const timeFrame = useMarketStore((s) => s.timeFrame);

  // Bind store to WebSocket manager events
  useEffect(() => {
    // 1. Status listener
    const unsubStatus = wsManager.subscribeStatus((status, latency) => {
      useMarketStore.getState().setConnectionStatus(status, latency);
    });

    // 2. Batched Tickers listener
    const unsubTickers = wsManager.subscribeTickerBatch((batch) => {
      useMarketStore.getState().updateTickersBatch(batch);

      const tradingState = useTradingStore.getState();
      const hasActiveOrders =
        tradingState.getOpenOrders().length > 0 ||
        tradingState.getActiveProtectiveOrders().length > 0;

      if (hasActiveOrders) {
        const quotes: Record<string, LiveQuote> = {};
        const now = Date.now();
        for (const [sym, update] of Object.entries(batch)) {
          // If book quote available, prefer real best bid/ask, else estimated
          const bookQuote = wsManager.getLatestBookQuote(sym);
          quotes[sym] = bookQuote || {
            symbol: sym,
            bidPrice: update.lastPrice * 0.9995,
            askPrice: update.lastPrice * 1.0005,
            lastPrice: update.lastPrice,
            timestamp: now,
          };
        }
        useTradingStore.getState().matchPendingOrders(quotes);
      }
    });

    // 3. Live Depth / Order Book listener (active symbol)
    const unsubDepth = wsManager.subscribeDepth((depth) => {
      useMarketStore.getState().setOrderBook(depth);

      const tradingState = useTradingStore.getState();
      const hasActiveOrders =
        tradingState.getOpenOrders().length > 0 ||
        tradingState.getActiveProtectiveOrders().length > 0;

      if (hasActiveOrders && depth.bids.length > 0 && depth.asks.length > 0) {
        const quotes: Record<string, LiveQuote> = {
          [depth.symbol]: {
            symbol: depth.symbol,
            bidPrice: depth.bids[0].price,
            askPrice: depth.asks[0].price,
            lastPrice: depth.bids[0].price,
            timestamp: Date.now(),
          },
        };
        useTradingStore.getState().matchPendingOrders(quotes);
      }
    });

    // 4. Real-time Multi-Symbol BookTicker listener
    // Ensures pending limit orders or protective triggers for any cryptocurrency match automatically
    // even when viewing a different pair on the chart
    const unsubBookTicker = wsManager.subscribeBookTicker((quote) => {
      const tradingState = useTradingStore.getState();
      const hasActiveForSymbol =
        tradingState.getOpenOrders().some((o) => o.symbol === quote.symbol) ||
        tradingState.getActiveProtectiveOrders(quote.symbol).length > 0;

      if (hasActiveForSymbol) {
        useTradingStore.getState().matchPendingOrders({
          [quote.symbol]: quote,
        });
      }
    });

    // Connect
    wsManager.connect();
    wsManager.setActiveSubscription(selectedSymbol, timeFrame);

    return () => {
      unsubStatus();
      unsubTickers();
      unsubDepth();
      unsubBookTicker();
    };
  }, []);

  // Update subscription when symbol or timeframe changes
  useEffect(() => {
    wsManager.setActiveSubscription(selectedSymbol, timeFrame);
  }, [selectedSymbol, timeFrame]);
}
