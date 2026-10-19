import { describe, it, expect } from 'vitest';
import { matchPendingOrders } from './orderMatcher';
import { TradeOrder, LiveQuote } from '../types';

describe('Limit Order Matching Engine', () => {
  const pendingBuyOrder: TradeOrder = {
    id: 'ord_buy_1',
    symbol: 'BTCUSDT',
    baseAsset: 'BTC',
    quoteAsset: 'USDT',
    side: 'buy',
    type: 'limit',
    price: 80000, // Willing to buy at or below $80,000
    quantity: 0.2,
    fee: 8,
    status: 'pending',
    reservedAmount: 16008,
    createdAt: 1000,
  };

  const pendingSellOrder: TradeOrder = {
    id: 'ord_sell_1',
    symbol: 'BTCUSDT',
    baseAsset: 'BTC',
    quoteAsset: 'USDT',
    side: 'sell',
    type: 'limit',
    price: 85000, // Willing to sell at or above $85,000
    quantity: 0.5,
    fee: 21.25,
    status: 'pending',
    reservedAmount: 0.5,
    createdAt: 1000,
  };

  it('fills limit buy order when Best Ask <= limit price', () => {
    // Current market quote: Ask is $79,950 <= limit $80,000
    const favorableQuotes: Record<string, LiveQuote> = {
      BTCUSDT: {
        symbol: 'BTCUSDT',
        bidPrice: 79900,
        askPrice: 79950,
        lastPrice: 79925,
        timestamp: 2000,
      },
    };

    const result = matchPendingOrders([pendingBuyOrder], favorableQuotes, 0.0005, 2000);
    expect(result.filledOrders).toHaveLength(1);
    expect(result.executions).toHaveLength(1);
    expect(result.remainingPendingOrders).toHaveLength(0);

    const filled = result.filledOrders[0];
    expect(filled.status).toBe('filled');
    expect(filled.filledPrice).toBe(79950);
    expect(filled.filledQuantity).toBe(0.2);

    const exec = result.executions[0];
    expect(exec.price).toBe(79950);
    expect(exec.quantity).toBe(0.2);
    expect(exec.grossValue).toBe(79950 * 0.2);
  });

  it('does NOT fill limit buy order when Best Ask > limit price', () => {
    // Ask is $81,000 > limit $80,000
    const unfavorableQuotes: Record<string, LiveQuote> = {
      BTCUSDT: {
        symbol: 'BTCUSDT',
        bidPrice: 80950,
        askPrice: 81000,
        lastPrice: 80975,
        timestamp: 2000,
      },
    };

    const result = matchPendingOrders([pendingBuyOrder], unfavorableQuotes);
    expect(result.filledOrders).toHaveLength(0);
    expect(result.executions).toHaveLength(0);
    expect(result.remainingPendingOrders).toHaveLength(1);
  });

  it('fills limit sell order when Best Bid >= limit price', () => {
    // Current market quote: Bid is $85,500 >= limit $85,000
    const favorableQuotes: Record<string, LiveQuote> = {
      BTCUSDT: {
        symbol: 'BTCUSDT',
        bidPrice: 85500,
        askPrice: 85550,
        lastPrice: 85525,
        timestamp: 2000,
      },
    };

    const result = matchPendingOrders([pendingSellOrder], favorableQuotes, 0.0005, 2000);
    expect(result.filledOrders).toHaveLength(1);
    expect(result.executions).toHaveLength(1);

    const filled = result.filledOrders[0];
    expect(filled.status).toBe('filled');
    expect(filled.filledPrice).toBe(85500);

    const exec = result.executions[0];
    expect(exec.price).toBe(85500);
  });

  it('matches multiple pending orders across different cryptocurrency symbols simultaneously', () => {
    const multiPendingOrders: TradeOrder[] = [
      {
        id: 'ord_eth_1',
        symbol: 'ETHUSDT',
        baseAsset: 'ETH',
        quoteAsset: 'USDT',
        side: 'buy',
        type: 'limit',
        price: 3500,
        quantity: 1.5,
        fee: 2.625,
        status: 'pending',
        reservedAmount: 5252.625,
        createdAt: 1000,
      },
      {
        id: 'ord_sol_1',
        symbol: 'SOLUSDT',
        baseAsset: 'SOL',
        quoteAsset: 'USDT',
        side: 'sell',
        type: 'limit',
        price: 180,
        quantity: 10,
        fee: 0.9,
        status: 'pending',
        reservedAmount: 10,
        createdAt: 1000,
      },
      {
        id: 'ord_bnb_1',
        symbol: 'BNBUSDT',
        baseAsset: 'BNB',
        quoteAsset: 'USDT',
        side: 'buy',
        type: 'limit',
        price: 600,
        quantity: 2,
        fee: 0.6,
        status: 'pending',
        reservedAmount: 1200.6,
        createdAt: 1000,
      },
    ];

    // ETH quote triggers buy (Ask 3490 <= 3500)
    // SOL quote triggers sell (Bid 182 >= 180)
    // BNB quote does NOT trigger buy (Ask 610 > 600)
    const multiQuotes: Record<string, LiveQuote> = {
      ETHUSDT: {
        symbol: 'ETHUSDT',
        bidPrice: 3485,
        askPrice: 3490,
        lastPrice: 3488,
        timestamp: 2000,
      },
      SOLUSDT: {
        symbol: 'SOLUSDT',
        bidPrice: 182,
        askPrice: 183,
        lastPrice: 182.5,
        timestamp: 2000,
      },
      BNBUSDT: {
        symbol: 'BNBUSDT',
        bidPrice: 608,
        askPrice: 610,
        lastPrice: 609,
        timestamp: 2000,
      },
    };

    const result = matchPendingOrders(multiPendingOrders, multiQuotes, 0.0005, 2000);

    expect(result.filledOrders).toHaveLength(2);
    expect(result.executions).toHaveLength(2);
    expect(result.remainingPendingOrders).toHaveLength(1);

    // Verified filled orders
    const filledSymbols = result.filledOrders.map((o) => o.symbol);
    expect(filledSymbols).toContain('ETHUSDT');
    expect(filledSymbols).toContain('SOLUSDT');

    // Remaining pending order
    expect(result.remainingPendingOrders[0].symbol).toBe('BNBUSDT');
  });

  it('rejects filling pending orders when incoming market quote is stale (> 60 seconds old)', () => {
    const quoteNow = 100_000;
    const staleQuoteTime = quoteNow - 65_000; // 65 seconds old > 60s max age

    const staleQuotes: Record<string, LiveQuote> = {
      BTCUSDT: {
        symbol: 'BTCUSDT',
        bidPrice: 79000,
        askPrice: 79500, // Price is favorable <= 80000 limit
        lastPrice: 79250,
        timestamp: staleQuoteTime,
      },
    };

    const result = matchPendingOrders([pendingBuyOrder], staleQuotes, 0.0005, quoteNow);

    // Order must remain pending and NOT fill against stale quote
    expect(result.filledOrders).toHaveLength(0);
    expect(result.executions).toHaveLength(0);
    expect(result.remainingPendingOrders).toHaveLength(1);
    expect(result.remainingPendingOrders[0].id).toBe(pendingBuyOrder.id);
  });
});
