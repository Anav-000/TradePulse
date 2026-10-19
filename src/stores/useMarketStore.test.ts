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
});
