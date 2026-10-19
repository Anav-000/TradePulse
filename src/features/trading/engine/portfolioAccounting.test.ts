import { describe, it, expect } from 'vitest';
import {
  applyBuyToPosition,
  applySellToPosition,
  calculatePortfolioStats,
} from './portfolioAccounting';
import { Position, TradeExecution } from '../types';

describe('Portfolio Accounting Engine', () => {
  it('creates a new position on initial buy with fees capitalized into cost basis', () => {
    const buyExec: TradeExecution = {
      id: 'exec_1',
      orderId: 'ord_1',
      symbol: 'BTCUSDT',
      baseAsset: 'BTC',
      quoteAsset: 'USDT',
      side: 'buy',
      type: 'market',
      price: 80000,
      quantity: 0.1,
      grossValue: 8000,
      fee: 4,
      netValue: 8004,
      timestamp: 1000,
    };

    const position = applyBuyToPosition(undefined, buyExec);
    expect(position.symbol).toBe('BTCUSDT');
    expect(position.quantity).toBe(0.1);
    expect(position.availableQuantity).toBe(0.1);
    expect(position.reservedQuantity).toBe(0);
    // Cost basis = 8,000 + 4 fee = $8,004
    expect(position.totalCostBasis).toBe(8004);
    // Average price = 8,004 / 0.1 = $80,040
    expect(position.averageEntryPrice).toBe(80040);
  });

  it('updates weighted average entry price across multiple buys at different prices', () => {
    // 1st Buy: 1.0 BTC @ $80,000 (fee: $40) -> total cost: $80,040
    const buy1: TradeExecution = {
      id: 'exec_1',
      orderId: 'ord_1',
      symbol: 'BTCUSDT',
      baseAsset: 'BTC',
      quoteAsset: 'USDT',
      side: 'buy',
      type: 'market',
      price: 80000,
      quantity: 1.0,
      grossValue: 80000,
      fee: 40,
      netValue: 80040,
      timestamp: 1000,
    };
    const pos1 = applyBuyToPosition(undefined, buy1);

    // 2nd Buy: 1.0 BTC @ $90,000 (fee: $45) -> total cost: $90,045
    const buy2: TradeExecution = {
      id: 'exec_2',
      orderId: 'ord_2',
      symbol: 'BTCUSDT',
      baseAsset: 'BTC',
      quoteAsset: 'USDT',
      side: 'buy',
      type: 'market',
      price: 90000,
      quantity: 1.0,
      grossValue: 90000,
      fee: 45,
      netValue: 90045,
      timestamp: 2000,
    };
    const pos2 = applyBuyToPosition(pos1, buy2);

    expect(pos2.quantity).toBe(2.0);
    // Total cost basis = 80,040 + 90,045 = 170,085
    expect(pos2.totalCostBasis).toBe(170085);
    // Average entry price = 170,085 / 2 = 85,042.5
    expect(pos2.averageEntryPrice).toBe(85042.5);
  });

  it('reduces cost basis proportionally and calculates realized P&L on partial sell', () => {
    const initialPosition: Position = {
      symbol: 'BTCUSDT',
      baseAsset: 'BTC',
      quoteAsset: 'USDT',
      quantity: 2.0,
      reservedQuantity: 0,
      availableQuantity: 2.0,
      averageEntryPrice: 80000,
      totalCostBasis: 160000, // 2 BTC @ $80k
      realizedPnl: 0,
      openedAt: 1000,
      updatedAt: 1000,
    };

    // Sell 1.0 BTC (50%) @ $90,000 (fee: $45)
    // Gross = $90,000, Net proceeds = 90,000 - 45 = $89,955
    // Cost basis of sold 1.0 BTC = 1/2 * 160,000 = $80,000
    // Realized P&L = 89,955 - 80,000 = +$9,955
    const sellExec: TradeExecution = {
      id: 'exec_sell_1',
      orderId: 'ord_sell_1',
      symbol: 'BTCUSDT',
      baseAsset: 'BTC',
      quoteAsset: 'USDT',
      side: 'sell',
      type: 'market',
      price: 90000,
      quantity: 1.0,
      grossValue: 90000,
      fee: 45,
      netValue: 89955,
      timestamp: 3000,
    };

    const { updatedPosition, realizedPnl } = applySellToPosition(initialPosition, sellExec);

    expect(realizedPnl).toBe(9955);
    expect(updatedPosition).not.toBeNull();
    expect(updatedPosition!.quantity).toBe(1.0);
    expect(updatedPosition!.totalCostBasis).toBe(80000);
    expect(updatedPosition!.averageEntryPrice).toBe(80000);
    expect(updatedPosition!.realizedPnl).toBe(9955);
  });

  it('closes position completely when selling 100% of holdings', () => {
    const initialPosition: Position = {
      symbol: 'BTCUSDT',
      baseAsset: 'BTC',
      quoteAsset: 'USDT',
      quantity: 0.5,
      reservedQuantity: 0,
      availableQuantity: 0.5,
      averageEntryPrice: 80000,
      totalCostBasis: 40000,
      realizedPnl: 500,
      openedAt: 1000,
      updatedAt: 1000,
    };

    const sellAll: TradeExecution = {
      id: 'exec_sell_all',
      orderId: 'ord_sell_all',
      symbol: 'BTCUSDT',
      baseAsset: 'BTC',
      quoteAsset: 'USDT',
      side: 'sell',
      type: 'market',
      price: 85000,
      quantity: 0.5,
      grossValue: 42500,
      fee: 21.25,
      netValue: 42478.75,
      timestamp: 4000,
    };

    const { updatedPosition, realizedPnl } = applySellToPosition(initialPosition, sellAll);
    // Realized P&L = 42,478.75 - 40,000 = 2478.75
    expect(realizedPnl).toBe(2478.75);
    expect(updatedPosition).toBeNull();
  });

  it('calculates portfolio stats, mark-to-market equity, and unrealized P&L', () => {
    const positions: Record<string, Position> = {
      BTCUSDT: {
        symbol: 'BTCUSDT',
        baseAsset: 'BTC',
        quoteAsset: 'USDT',
        quantity: 0.5,
        reservedQuantity: 0,
        availableQuantity: 0.5,
        averageEntryPrice: 80000,
        totalCostBasis: 40000,
        realizedPnl: 0,
        openedAt: 1000,
        updatedAt: 1000,
      },
    };

    // Current price is $84,000 (BTC has increased in value)
    const marketPrices = { BTCUSDT: 84000 };
    // USDT balance: 10,000, reserved: 2,000 (available: 8,000)
    const stats = calculatePortfolioStats(10000, 2000, positions, marketPrices, 25, 1500);

    // Invested value = 0.5 * 84,000 = $42,000
    expect(stats.investedValue).toBe(42000);
    // Total equity = 10,000 + 42,000 = $52,000
    expect(stats.totalEquity).toBe(52000);
    expect(stats.availableUsdt).toBe(8000);
    expect(stats.reservedUsdt).toBe(2000);
    // Unrealized P&L = 42,000 - 40,000 = +$2,000
    expect(stats.unrealizedPnl).toBe(2000);
    // Unrealized P&L % = 2,000 / 40,000 = +5.00%
    expect(stats.unrealizedPnlPercent).toBe(5);
    // Total return % on 50k initial = (52,000 - 50,000) / 50,000 = +4.00%
    expect(stats.totalReturnPercent).toBe(4);
    expect(stats.realizedPnl).toBe(1500);
    expect(stats.totalFeesPaid).toBe(25);
  });
});
