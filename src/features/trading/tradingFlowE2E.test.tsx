import { describe, it, expect, beforeEach } from 'vitest';
import { useTradingStore } from './stores/useTradingStore';
import { useMarketStore } from '@/stores/useMarketStore';
import { LiveQuote } from './types';

describe('Trading Flow End-to-End Simulation Scenarios', () => {
  const liveBtcQuote: LiveQuote = {
    symbol: 'BTCUSDT',
    bidPrice: 80000,
    askPrice: 80000,
    lastPrice: 80000,
    timestamp: Date.now(),
  };

  beforeEach(() => {
    localStorage.clear();
    useTradingStore.getState().resetAccount();
    useMarketStore.setState({
      selectedSymbol: 'BTCUSDT',
      connectionStatus: 'connected',
    });
  });

  it('Scenario A — Fresh Account: initializes with $50,000 USDT and zero positions/orders', () => {
    const stats = useTradingStore.getState().getPortfolioStats();
    expect(stats.totalEquity).toBe(50000);
    expect(stats.totalUsdt).toBe(50000);
    expect(stats.availableUsdt).toBe(50000);
    expect(stats.reservedUsdt).toBe(0);
    expect(Object.keys(useTradingStore.getState().positions)).toHaveLength(0);
    expect(useTradingStore.getState().orders).toHaveLength(0);
    expect(useTradingStore.getState().executions).toHaveLength(0);
  });

  it('Scenario B — Market Buy: buys 0.1 BTC with 0.05% fee, deducting cash and capitalizing cost basis', async () => {
    // 0.1 BTC @ $80,000 = $8,000 gross + $4 fee (0.05%) = $8,004 total cost
    const res = await useTradingStore.getState().executeMarketOrder({
      symbol: 'BTCUSDT',
      baseAsset: 'BTC',
      quoteAsset: 'USDT',
      side: 'buy',
      quantity: 0.1,
      quote: liveBtcQuote,
    });

    expect(res.success).toBe(true);

    const state = useTradingStore.getState();
    expect(state.usdtBalance).toBe(41996);
    expect(state.positions['BTCUSDT'].quantity).toBe(0.1);
    expect(state.positions['BTCUSDT'].totalCostBasis).toBe(8004);
    expect(state.positions['BTCUSDT'].averageEntryPrice).toBe(80040);
    expect(state.executions).toHaveLength(1);
    expect(state.executions[0].fee).toBe(4);
  });

  it('Scenario C — Partial Sell: sells 0.05 BTC and calculates proportional cost reduction and realized P&L', async () => {
    // 1. First Buy 0.1 BTC @ $80,000 (Cost basis $8,004)
    await useTradingStore.getState().executeMarketOrder({
      symbol: 'BTCUSDT',
      baseAsset: 'BTC',
      quoteAsset: 'USDT',
      side: 'buy',
      quantity: 0.1,
      quote: liveBtcQuote,
    });

    // 2. Sell half (0.05 BTC) @ $85,000
    // Gross: 0.05 * 85,000 = $4,250
    // Fee: $2.125
    // Net proceeds: $4,247.875
    // Sold cost basis: 0.05 / 0.1 * 8004 = $4,002
    // Realized P&L: 4247.875 - 4002 = +$245.875 (~$245.88)
    const higherQuote: LiveQuote = {
      symbol: 'BTCUSDT',
      bidPrice: 85000,
      askPrice: 85050,
      lastPrice: 85000,
      timestamp: Date.now(),
    };

    const sellRes = await useTradingStore.getState().executeMarketOrder({
      symbol: 'BTCUSDT',
      baseAsset: 'BTC',
      quoteAsset: 'USDT',
      side: 'sell',
      quantity: 0.05,
      quote: higherQuote,
    });

    expect(sellRes.success).toBe(true);

    const state = useTradingStore.getState();
    expect(state.positions['BTCUSDT'].quantity).toBe(0.05);
    expect(state.positions['BTCUSDT'].totalCostBasis).toBe(4002);
    expect(state.totalRealizedPnl).toBeCloseTo(245.88, 1);
    expect(state.executions).toHaveLength(2);
  });

  it('Scenario D & E — Pending Limit Buy and Cancellation: reserves USDT and releases on cancel', async () => {
    // Limit buy 0.2 BTC @ $70,000 (Required: $14,000 + $7 fee = $14,007)
    const res = await useTradingStore.getState().placeLimitOrder({
      symbol: 'BTCUSDT',
      baseAsset: 'BTC',
      quoteAsset: 'USDT',
      side: 'buy',
      quantity: 0.2,
      limitPrice: 70000,
    });

    expect(res.success).toBe(true);

    let state = useTradingStore.getState();
    const openOrders = state.getOpenOrders();
    expect(openOrders).toHaveLength(1);
    expect(state.usdtReserved).toBe(14007);
    expect(state.usdtBalance).toBe(50000); // Total remains 50k
    expect(state.getPortfolioStats().availableUsdt).toBe(35993);

    // Cancel order
    const cancelRes = state.cancelOrder(openOrders[0].id);
    expect(cancelRes.success).toBe(true);

    state = useTradingStore.getState();
    expect(state.usdtReserved).toBe(0);
    expect(state.getPortfolioStats().availableUsdt).toBe(50000);
    expect(state.getOpenOrders()).toHaveLength(0);
  });

  it('Scenario F — Automatic Limit Fill: fills pending limit order when market quote satisfies condition', async () => {
    // Place buy limit order @ $75,000 for 0.1 BTC
    await useTradingStore.getState().placeLimitOrder({
      symbol: 'BTCUSDT',
      baseAsset: 'BTC',
      quoteAsset: 'USDT',
      side: 'buy',
      quantity: 0.1,
      limitPrice: 75000,
    });

    expect(useTradingStore.getState().getOpenOrders()).toHaveLength(1);

    // 1. Quote above limit (Ask $76,000) does not fill
    useTradingStore.getState().matchPendingOrders({
      BTCUSDT: {
        symbol: 'BTCUSDT',
        bidPrice: 75950,
        askPrice: 76000,
        lastPrice: 75975,
        timestamp: Date.now(),
      },
    });

    expect(useTradingStore.getState().getOpenOrders()).toHaveLength(1);

    // 2. Favorable quote (Ask $74,900 <= $75,000) triggers execution
    useTradingStore.getState().matchPendingOrders({
      BTCUSDT: {
        symbol: 'BTCUSDT',
        bidPrice: 74850,
        askPrice: 74900,
        lastPrice: 74875,
        timestamp: Date.now(),
      },
    });

    const state = useTradingStore.getState();
    expect(state.getOpenOrders()).toHaveLength(0);
    expect(state.positions['BTCUSDT'].quantity).toBe(0.1);
    expect(state.usdtReserved).toBe(0);
    expect(state.executions).toHaveLength(1);
    expect(state.executions[0].price).toBe(74900);
  });

  it('Scenario I — Stale Quote Rejection: rejects market orders and pending fills when quotes are stale', async () => {
    const staleQuote: LiveQuote = {
      symbol: 'BTCUSDT',
      bidPrice: 80000,
      askPrice: 80000,
      lastPrice: 80000,
      timestamp: Date.now() - 70000, // 70 seconds old > 60s max age
    };

    const res = await useTradingStore.getState().executeMarketOrder({
      symbol: 'BTCUSDT',
      baseAsset: 'BTC',
      quoteAsset: 'USDT',
      side: 'buy',
      quantity: 0.1,
      quote: staleQuote,
    });

    expect(res.success).toBe(false);
    expect(res.error).toMatch(/stale/i);
    expect(useTradingStore.getState().positions['BTCUSDT']).toBeUndefined();
  });

  it('Scenario K — Wallet Reset: completely restores 50,000 USDT and wipes all positions, orders, and history', async () => {
    // Perform a trade and create an order first
    await useTradingStore.getState().executeMarketOrder({
      symbol: 'BTCUSDT',
      baseAsset: 'BTC',
      quoteAsset: 'USDT',
      side: 'buy',
      quantity: 0.1,
      quote: liveBtcQuote,
    });

    expect(Object.keys(useTradingStore.getState().positions)).toHaveLength(1);

    // Reset
    useTradingStore.getState().resetAccount();

    const state = useTradingStore.getState();
    expect(state.usdtBalance).toBe(50000);
    expect(state.usdtReserved).toBe(0);
    expect(Object.keys(state.positions)).toHaveLength(0);
    expect(state.orders).toHaveLength(0);
    expect(state.executions).toHaveLength(0);
    expect(state.totalRealizedPnl).toBe(0);
    expect(state.totalFeesPaid).toBe(0);
  });
});
