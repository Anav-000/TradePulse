import { useEffect } from 'react';
import { useMarketStore } from '@/stores/useMarketStore';
import { useTradingStore } from '@/features/trading/stores/useTradingStore';
import { LiveQuote } from '@/features/trading/types';
import { wsManager, SUPPORTED_SYMBOLS } from './BinanceWebSocketManager';
import { fetch24hrTickers } from '@/services/api/marketApi';

/**
 * Initializes and manages market data synchronization:
 * 1. Immediate REST hydration on mount to ensure real Binance prices within 100ms
 * 2. WebSocket streaming for sub-second updates, order book depth, and klines
 * 3. Resilient REST polling fallback if WebSocket is blocked, delayed, or disconnected
 * 4. High-frequency matching for pending limit & protective orders
 */
export function useWebSocketStream() {
  const selectedSymbol = useMarketStore((s) => s.selectedSymbol);
  const timeFrame = useMarketStore((s) => s.timeFrame);

  // Bind store to WebSocket manager events and REST hydration
  useEffect(() => {
    let isMounted = true;

    // 1. Immediate REST hydration: overwrite initial placeholders with verified 24hr Binance data
    fetch24hrTickers(SUPPORTED_SYMBOLS)
      .then((res) => {
        if (!isMounted) return;
        useMarketStore.getState().updateTickersBatch(res.tickers, 'rest');
        wsManager.ingestBookQuotes(res.bookQuotes);
      })
      .catch((err) => {
        console.warn('[useWebSocketStream] Initial REST ticker hydration failed:', err);
      });

    // 2. Status listener
    const unsubStatus = wsManager.subscribeStatus((status, latency) => {
      useMarketStore.getState().setConnectionStatus(status, latency);
    });

    // 3. Batched Tickers listener
    const unsubTickers = wsManager.subscribeTickerBatch((batch) => {
      useMarketStore.getState().updateTickersBatch(batch, 'websocket');

      const tradingState = useTradingStore.getState();
      const hasActiveOrders =
        tradingState.getOpenOrders().length > 0 ||
        tradingState.getActiveProtectiveOrders().length > 0;

      if (hasActiveOrders) {
        const quotes: Record<string, LiveQuote> = {};
        const now = Date.now();
        for (const [sym, update] of Object.entries(batch)) {
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

    // 4. Live Depth / Order Book listener (active symbol)
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

    // 5. Real-time Multi-Symbol BookTicker listener
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

    // 6. Connect WebSocket
    wsManager.connect();
    wsManager.setActiveSubscription(selectedSymbol, timeFrame);

    // 7. Resilient Fallback Polling Interval
    // Ensures tickers and order matching remain fresh even if WebSocket is blocked by client network/firewall
    let lastPollTime = Date.now();
    const pollInterval = setInterval(() => {
      if (!isMounted) return;
      const status = useMarketStore.getState().connectionStatus;
      const intervalNeeded = status === 'connected' ? 30000 : 5000;
      const now = Date.now();

      if (now - lastPollTime >= intervalNeeded) {
        lastPollTime = now;
        fetch24hrTickers(SUPPORTED_SYMBOLS)
          .then((res) => {
            if (!isMounted) return;
            useMarketStore.getState().updateTickersBatch(res.tickers, 'rest');
            wsManager.ingestBookQuotes(res.bookQuotes);

            if (status !== 'connected') {
              const tradingState = useTradingStore.getState();
              const hasActive =
                tradingState.getOpenOrders().length > 0 ||
                tradingState.getActiveProtectiveOrders().length > 0;
              if (hasActive) {
                tradingState.matchPendingOrders(res.bookQuotes);
              }
            }
          })
          .catch(() => {
            // Silently ignore background polling errors
          });
      }
    }, 2500);

    return () => {
      isMounted = false;
      clearInterval(pollInterval);
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
