import { describe, it, expect } from 'vitest';
import { useMarketStore } from './useMarketStore';

describe('useMarketStore', () => {
  it('initializes with default ticker selection', () => {
    const state = useMarketStore.getState();
    expect(state.selectedSymbol).toBe('BTCUSDT');
    expect(state.getSelectedTicker().baseAsset).toBe('BTC');
  });

  it('allows switching selected symbols', () => {
    useMarketStore.getState().setSelectedSymbol('ETHUSDT');
    const state = useMarketStore.getState();
    expect(state.selectedSymbol).toBe('ETHUSDT');
    expect(state.getSelectedTicker().baseAsset).toBe('ETH');
  });

  it('toggles favorite status of an asset', () => {
    const initialFav = useMarketStore
      .getState()
      .tickers.find((t) => t.symbol === 'BNBUSDT')?.isFavorite;
    useMarketStore.getState().toggleFavorite('BNBUSDT');
    const updatedFav = useMarketStore
      .getState()
      .tickers.find((t) => t.symbol === 'BNBUSDT')?.isFavorite;
    expect(updatedFav).toBe(!initialFav);
  });

  it('synchronizes ticker price when mock or stale', () => {
    useMarketStore.setState((state) => ({
      tickers: state.tickers.map((t) =>
        t.symbol === 'BTCUSDT' ? { ...t, lastPrice: 67842.5, source: 'mock' as const, lastUpdated: 0 } : t
      ),
    }));

    useMarketStore.getState().syncTickerPrice('BTCUSDT', 82086.0);
    const btc = useMarketStore.getState().tickers.find((t) => t.symbol === 'BTCUSDT');
    expect(btc?.lastPrice).toBe(82086.0);
    expect(btc?.source).toBe('candle_sync');
  });

  it('preserves fresh live ticker and refuses to overwrite with older candle close', () => {
    const now = Date.now();
    useMarketStore.setState((state) => ({
      tickers: state.tickers.map((t) =>
        t.symbol === 'BTCUSDT'
          ? { ...t, lastPrice: 82500.0, source: 'websocket' as const, lastUpdated: now - 2000 }
          : t
      ),
    }));

    useMarketStore.getState().syncTickerPrice('BTCUSDT', 81900.0, {
      candleTimestamp: now - 60000,
    });
    const btc = useMarketStore.getState().tickers.find((t) => t.symbol === 'BTCUSDT');
    expect(btc?.lastPrice).toBe(82500.0);
    expect(btc?.source).toBe('websocket');
  });
});
