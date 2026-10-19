import { describe, it, expect, beforeEach } from 'vitest';
import { useTradingStore } from './useTradingStore';
import { LiveQuote } from '../types';

describe('useTradingStore Integration & Lifecycle', () => {
  beforeEach(() => {
    // Reset store before each test
    useTradingStore.getState().resetAccount();
    localStorage.clear();
  });

  const btcQuote: LiveQuote = {
    symbol: 'BTCUSDT',
    bidPrice: 80000,
    askPrice: 80100,
    lastPrice: 80050,
    timestamp: Date.now(),
  };

  it('initializes with 50,000 USDT and zero positions', () => {
    const state = useTradingStore.getState();
    expect(state.usdtBalance).toBe(50000);
    expect(state.usdtReserved).toBe(0);
    expect(state.getAvailableUsdt()).toBe(50000);
    expect(Object.keys(state.positions)).toHaveLength(0);
    expect(state.orders).toHaveLength(0);
    expect(state.executions).toHaveLength(0);
  });

  it('executes simulated market buy and updates balances and positions atomically', async () => {
    const result = await useTradingStore.getState().executeMarketOrder({
      symbol: 'BTCUSDT',
      baseAsset: 'BTC',
      quoteAsset: 'USDT',
      side: 'buy',
      quantity: 0.1,
      quote: btcQuote,
    });

    expect(result.success).toBe(true);
    const state = useTradingStore.getState();

    // 0.1 BTC @ $80,100 (ask) = $8,010 gross + $4.005 fee = $8,014.005
    expect(state.usdtBalance).toBeLessThan(50000);
    expect(state.getAvailableUsdt()).toBe(state.usdtBalance);

    const pos = state.getPosition('BTCUSDT');
    expect(pos).toBeDefined();
    expect(pos?.quantity).toBe(0.1);
    expect(pos?.availableQuantity).toBe(0.1);

    expect(state.executions).toHaveLength(1);
    expect(state.orders).toHaveLength(1);
    expect(state.orders[0].status).toBe('filled');
    expect(state.notifications.length).toBeGreaterThan(0);
  });

  it('rejects market buy when available USDT is insufficient without mutating state', async () => {
    const result = await useTradingStore.getState().executeMarketOrder({
      symbol: 'BTCUSDT',
      baseAsset: 'BTC',
      quoteAsset: 'USDT',
      side: 'buy',
      quantity: 1.0, // 1 BTC @ 80k > 50k balance
      quote: btcQuote,
    });

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/insufficient/i);

    const state = useTradingStore.getState();
    expect(state.usdtBalance).toBe(50000);
    expect(Object.keys(state.positions)).toHaveLength(0);
    expect(state.executions).toHaveLength(0);
  });

  it('executes simulated market sell and realizes P&L accurately', async () => {
    // 1. Buy 0.2 BTC @ $80,100
    await useTradingStore.getState().executeMarketOrder({
      symbol: 'BTCUSDT',
      baseAsset: 'BTC',
      quoteAsset: 'USDT',
      side: 'buy',
      quantity: 0.2,
      quote: btcQuote,
    });

    const balanceAfterBuy = useTradingStore.getState().usdtBalance;

    // 2. Market price rises: Bid is now $90,000
    const higherQuote: LiveQuote = {
      symbol: 'BTCUSDT',
      bidPrice: 90000,
      askPrice: 90100,
      lastPrice: 90050,
      timestamp: Date.now(),
    };

    // 3. Sell 0.1 BTC (half the position) @ $90,000
    const sellResult = await useTradingStore.getState().executeMarketOrder({
      symbol: 'BTCUSDT',
      baseAsset: 'BTC',
      quoteAsset: 'USDT',
      side: 'sell',
      quantity: 0.1,
      quote: higherQuote,
    });

    expect(sellResult.success).toBe(true);

    const state = useTradingStore.getState();
    // USDT increased by net proceeds
    expect(state.usdtBalance).toBeGreaterThan(balanceAfterBuy);
    // Realized P&L is positive
    expect(state.totalRealizedPnl).toBeGreaterThan(0);

    const pos = state.getPosition('BTCUSDT');
    expect(pos?.quantity).toBeCloseTo(0.1, 4);
  });

  it('places limit order and manages reserved balance correctly', async () => {
    // Place Limit Buy: 0.1 BTC @ $75,000
    // Total required: 0.1 * 75,000 * 1.0005 = $7,503.75
    const placeResult = await useTradingStore.getState().placeLimitOrder({
      symbol: 'BTCUSDT',
      baseAsset: 'BTC',
      quoteAsset: 'USDT',
      side: 'buy',
      quantity: 0.1,
      limitPrice: 75000,
    });

    expect(placeResult.success).toBe(true);

    const state = useTradingStore.getState();
    expect(state.orders).toHaveLength(1);
    expect(state.orders[0].status).toBe('pending');

    // Total USDT remains 50,000, but reserved increases
    expect(state.usdtBalance).toBe(50000);
    expect(state.usdtReserved).toBeGreaterThan(7500);
    // Available USDT decreases
    expect(state.getAvailableUsdt()).toBeLessThan(50000);

    // Cancel order
    const cancelResult = useTradingStore.getState().cancelOrder(state.orders[0].id);
    expect(cancelResult.success).toBe(true);

    const stateAfterCancel = useTradingStore.getState();
    expect(stateAfterCancel.orders[0].status).toBe('canceled');
    // Reserved funds released back to 0
    expect(stateAfterCancel.usdtReserved).toBe(0);
    expect(stateAfterCancel.getAvailableUsdt()).toBe(50000);
  });

  it('matches pending limit orders automatically when quotes hit the limit condition', async () => {
    // Place Limit Buy: 0.1 BTC @ $78,000
    await useTradingStore.getState().placeLimitOrder({
      symbol: 'BTCUSDT',
      baseAsset: 'BTC',
      quoteAsset: 'USDT',
      side: 'buy',
      quantity: 0.1,
      limitPrice: 78000,
    });

    expect(useTradingStore.getState().getOpenOrders()).toHaveLength(1);

    // Incoming market tick drops Ask to $77,900 <= limit $78,000
    const matchingQuotes: Record<string, LiveQuote> = {
      BTCUSDT: {
        symbol: 'BTCUSDT',
        bidPrice: 77800,
        askPrice: 77900,
        lastPrice: 77850,
        timestamp: Date.now(),
      },
    };

    useTradingStore.getState().matchPendingOrders(matchingQuotes);

    const state = useTradingStore.getState();
    expect(state.getOpenOrders()).toHaveLength(0); // Filled!
    expect(state.orders[0].status).toBe('filled');
    expect(state.orders[0].filledPrice).toBe(77900);
    expect(state.usdtReserved).toBe(0);

    const pos = state.getPosition('BTCUSDT');
    expect(pos?.quantity).toBe(0.1);
  });

  it('resets the account safely back to initial 50k capital', async () => {
    await useTradingStore.getState().executeMarketOrder({
      symbol: 'BTCUSDT',
      baseAsset: 'BTC',
      quoteAsset: 'USDT',
      side: 'buy',
      quantity: 0.1,
      quote: btcQuote,
    });

    expect(useTradingStore.getState().usdtBalance).not.toBe(50000);

    useTradingStore.getState().resetAccount();

    const state = useTradingStore.getState();
    expect(state.usdtBalance).toBe(50000);
    expect(state.usdtReserved).toBe(0);
    expect(Object.keys(state.positions)).toHaveLength(0);
    expect(state.orders).toHaveLength(0);
    expect(state.executions).toHaveLength(0);
    expect(state.protectiveOrders).toHaveLength(0);
  });

  it('manages Stop-Loss and Take-Profit protective orders and executes triggers on incoming quotes', async () => {
    // 1. Buy 0.01 BTC
    await useTradingStore.getState().executeMarketOrder({
      symbol: 'BTCUSDT',
      baseAsset: 'BTC',
      quoteAsset: 'USDT',
      side: 'buy',
      quantity: 0.01,
      quote: btcQuote,
    });

    const pos = useTradingStore.getState().getPosition('BTCUSDT')!;
    expect(pos.quantity).toBe(0.01);
    expect(pos.availableQuantity).toBe(0.01);

    // 2. Set OCO protection: SL at $75,000, TP at $88,000 for 0.005 BTC
    const res = await useTradingStore.getState().setProtectiveOrder({
      symbol: 'BTCUSDT',
      baseAsset: 'BTC',
      quoteAsset: 'USDT',
      quantity: 0.005,
      stopLossPrice: 75000,
      takeProfitPrice: 88000,
      quote: btcQuote,
    });

    expect(res.success).toBe(true);
    expect(useTradingStore.getState().getActiveProtectiveOrders('BTCUSDT')).toHaveLength(2);

    // Holding reserved exactly once
    const posAfterProt = useTradingStore.getState().getPosition('BTCUSDT')!;
    expect(posAfterProt.reservedQuantity).toBe(0.005);
    expect(posAfterProt.availableQuantity).toBe(0.005);

    // 3. Incoming market price surges to $88,500 (triggers Take-Profit)
    const surgeQuote: Record<string, LiveQuote> = {
      BTCUSDT: {
        symbol: 'BTCUSDT',
        bidPrice: 88500,
        askPrice: 88510,
        lastPrice: 88500,
        timestamp: Date.now(),
      },
    };

    useTradingStore.getState().matchPendingOrders(surgeQuote);

    // Active protective orders should now be 0 (TP executed, SL canceled)
    expect(useTradingStore.getState().getActiveProtectiveOrders('BTCUSDT')).toHaveLength(0);

    const allProtective = useTradingStore.getState().getProtectiveOrders('BTCUSDT');
    const tpOrder = allProtective.find((p) => p.triggerType === 'take-profit');
    const slOrder = allProtective.find((p) => p.triggerType === 'stop-loss');

    expect(tpOrder?.status).toBe('executed');
    expect(slOrder?.status).toBe('cancelled');

    // Position decreased by 0.005 BTC to 0.005 BTC
    const posAfterExecution = useTradingStore.getState().getPosition('BTCUSDT')!;
    expect(posAfterExecution.quantity).toBe(0.005);
    expect(posAfterExecution.reservedQuantity).toBe(0);
    expect(posAfterExecution.availableQuantity).toBe(0.005);
  });

  it('manually canceling Stop-Loss cancels the linked Take-Profit atomically and releases reservation once', async () => {
    // Buy 0.004 BTC
    await useTradingStore.getState().executeMarketOrder({
      symbol: 'BTCUSDT',
      baseAsset: 'BTC',
      quoteAsset: 'USDT',
      side: 'buy',
      quantity: 0.004,
      quote: btcQuote,
    });

    const pos = useTradingStore.getState().getPosition('BTCUSDT')!;
    expect(pos.quantity).toBe(0.004);
    expect(pos.availableQuantity).toBe(0.004);

    // Fresh quote: market bid is $82,000, SL at $81,000, TP at $83,000
    const freshBtcQuote: LiveQuote = {
      symbol: 'BTCUSDT',
      bidPrice: 82000,
      askPrice: 82050,
      lastPrice: 82000,
      timestamp: Date.now(),
    };

    // Create linked OCO protection for 0.001 BTC: SL $81,000, TP $83,000
    const res = await useTradingStore.getState().setProtectiveOrder({
      symbol: 'BTCUSDT',
      baseAsset: 'BTC',
      quoteAsset: 'USDT',
      quantity: 0.001,
      stopLossPrice: 81000,
      takeProfitPrice: 83000,
      quote: freshBtcQuote,
    });

    expect(res.success).toBe(true);
    expect(useTradingStore.getState().getActiveProtectiveOrders('BTCUSDT')).toHaveLength(2);

    const posDuringProt = useTradingStore.getState().getPosition('BTCUSDT')!;
    expect(posDuringProt.quantity).toBe(0.004);
    expect(posDuringProt.reservedQuantity).toBe(0.001);
    expect(posDuringProt.availableQuantity).toBe(0.003);

    // Cancel Stop-Loss manually
    const sl = res.createdOrders!.find((o) => o.triggerType === 'stop-loss')!;
    const cancelResult = useTradingStore.getState().cancelProtectiveOrder(sl.id);
    expect(cancelResult.success).toBe(true);

    // Both orders must now be CANCELLED, active count must be 0
    expect(useTradingStore.getState().getActiveProtectiveOrders('BTCUSDT')).toHaveLength(0);
    const allProt = useTradingStore.getState().getProtectiveOrders('BTCUSDT');
    expect(allProt.every((p) => p.status === 'cancelled')).toBe(true);

    // Reservation released: total 0.004, reserved 0, available 0.004
    const posAfterCancel = useTradingStore.getState().getPosition('BTCUSDT')!;
    expect(posAfterCancel.quantity).toBe(0.004);
    expect(posAfterCancel.reservedQuantity).toBe(0);
    expect(posAfterCancel.availableQuantity).toBe(0.004);

    // Notification toast reflects atomic OCO cancellation
    const latestNotif = useTradingStore.getState().notifications[0];
    expect(latestNotif.title).toBe('Linked OCO Protection Cancelled');
    expect(latestNotif.message).toBe('Both Stop-Loss and Take-Profit orders cancelled. Reserved BTC released.');

    // Repeated cancel attempt on either order does not change balances or release again
    const repeatCancel = useTradingStore.getState().cancelProtectiveOrder(sl.id);
    expect(repeatCancel.success).toBe(false);
    expect(useTradingStore.getState().getPosition('BTCUSDT')!.reservedQuantity).toBe(0);
    expect(useTradingStore.getState().getPosition('BTCUSDT')!.availableQuantity).toBe(0.004);
  });
});
