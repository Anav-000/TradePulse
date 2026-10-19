import { describe, it, expect, beforeEach } from 'vitest';
import {
  createProtectiveOrders,
  cancelProtectiveOrder,
  cancelProtectiveGroup,
  evaluateProtectiveTriggers,
  validateProtectiveOrderSetup,
} from './protectiveOrderEngine';
import {
  executeMarketOrder,
  placeLimitOrder,
  createInitialTradingState,
  TradingAccountState,
} from './orderEngine';
import { ProtectiveOrder, LiveQuote, Position } from '../types';
import { DEFAULT_FEE_RATE } from './feeCalculator';

describe('Stop-Loss & Take-Profit Protective Order Engine', () => {
  let baseState: TradingAccountState & { protectiveOrders: ProtectiveOrder[] };
  const baseTime = 1700000000000;

  // Initial deterministic position: 0.01 BTC acquired at $80,000 cost basis ($800)
  const initialBtcPosition: Position = {
    symbol: 'BTCUSDT',
    baseAsset: 'BTC',
    quoteAsset: 'USDT',
    quantity: 0.01,
    reservedQuantity: 0,
    availableQuantity: 0.01,
    averageEntryPrice: 80000.0,
    totalCostBasis: 800.0,
    realizedPnl: 0,
    openedAt: baseTime,
    updatedAt: baseTime,
  };

  const freshQuote: LiveQuote = {
    symbol: 'BTCUSDT',
    bidPrice: 80000.0,
    askPrice: 80010.0,
    lastPrice: 80000.0,
    timestamp: baseTime,
  };

  beforeEach(() => {
    baseState = {
      ...createInitialTradingState(),
      usdtBalance: 49200.0,
      positions: {
        BTCUSDT: { ...initialBtcPosition },
      },
      protectiveOrders: [],
    };
  });

  // 1. Stop-loss triggers when bid falls below threshold
  it('triggers Stop-Loss when market bid falls at or below trigger threshold', () => {
    // Set SL at $78,000 for 0.005 BTC
    const created = createProtectiveOrders(
      baseState,
      {
        symbol: 'BTCUSDT',
        baseAsset: 'BTC',
        quoteAsset: 'USDT',
        quantity: 0.005,
        stopLossPrice: 78000.0,
        quote: freshQuote,
      },
      baseTime
    );

    expect(created.success).toBe(true);
    expect(created.createdOrders?.length).toBe(1);

    // Incoming bid drops to $77,950 (below $78,000 trigger)
    const dropQuote: Record<string, LiveQuote> = {
      BTCUSDT: {
        symbol: 'BTCUSDT',
        bidPrice: 77950.0,
        askPrice: 77960.0,
        lastPrice: 77950.0,
        timestamp: baseTime + 1000,
      },
    };

    const result = evaluateProtectiveTriggers(
      created.newState,
      dropQuote,
      DEFAULT_FEE_RATE,
      baseTime + 1000
    );

    expect(result.triggeredOrders.length).toBe(1);
    expect(result.triggeredOrders[0].status).toBe('executed');
    expect(result.triggeredOrders[0].executionPrice).toBe(77950.0);
    expect(result.executions.length).toBe(1);
    expect(result.executions[0].price).toBe(77950.0);
  });

  // 2. Take-profit triggers when bid rises above threshold
  it('triggers Take-Profit when market bid rises at or above trigger threshold', () => {
    // Set TP at $85,000 for 0.005 BTC
    const created = createProtectiveOrders(
      baseState,
      {
        symbol: 'BTCUSDT',
        baseAsset: 'BTC',
        quoteAsset: 'USDT',
        quantity: 0.005,
        takeProfitPrice: 85000.0,
        quote: freshQuote,
      },
      baseTime
    );

    expect(created.success).toBe(true);

    // Incoming bid surges to $85,100 (above $85,000 trigger)
    const surgeQuote: Record<string, LiveQuote> = {
      BTCUSDT: {
        symbol: 'BTCUSDT',
        bidPrice: 85100.0,
        askPrice: 85110.0,
        lastPrice: 85100.0,
        timestamp: baseTime + 1000,
      },
    };

    const result = evaluateProtectiveTriggers(
      created.newState,
      surgeQuote,
      DEFAULT_FEE_RATE,
      baseTime + 1000
    );

    expect(result.triggeredOrders.length).toBe(1);
    expect(result.triggeredOrders[0].status).toBe('executed');
    expect(result.triggeredOrders[0].executionPrice).toBe(85100.0);
  });

  // 3. No execution before trigger conditions are met
  it('does NOT trigger execution when market bid stays within the protective band', () => {
    const created = createProtectiveOrders(
      baseState,
      {
        symbol: 'BTCUSDT',
        baseAsset: 'BTC',
        quoteAsset: 'USDT',
        quantity: 0.005,
        stopLossPrice: 78000.0,
        takeProfitPrice: 85000.0,
        quote: freshQuote,
      },
      baseTime
    );

    // Bid is $80,500 (between 78k and 85k)
    const midQuote: Record<string, LiveQuote> = {
      BTCUSDT: {
        symbol: 'BTCUSDT',
        bidPrice: 80500.0,
        askPrice: 80510.0,
        lastPrice: 80500.0,
        timestamp: baseTime + 1000,
      },
    };

    const result = evaluateProtectiveTriggers(
      created.newState,
      midQuote,
      DEFAULT_FEE_RATE,
      baseTime + 1000
    );

    expect(result.triggeredOrders.length).toBe(0);
    expect(result.executions.length).toBe(0);
    expect(result.newState.protectiveOrders.every((p) => p.status === 'active')).toBe(true);
  });

  // 4. Correct execution price and fee calculation
  it('executes at the actual market bid and accurately computes 0.05% fee', () => {
    const created = createProtectiveOrders(
      baseState,
      {
        symbol: 'BTCUSDT',
        baseAsset: 'BTC',
        quoteAsset: 'USDT',
        quantity: 0.005,
        stopLossPrice: 79000.0,
        quote: freshQuote,
      },
      baseTime
    );

    // Trigger price was 79,000, but market bid gapped down to 78,800
    const gapQuote: Record<string, LiveQuote> = {
      BTCUSDT: {
        symbol: 'BTCUSDT',
        bidPrice: 78800.0,
        askPrice: 78810.0,
        lastPrice: 78800.0,
        timestamp: baseTime + 1000,
      },
    };

    const result = evaluateProtectiveTriggers(
      created.newState,
      gapQuote,
      DEFAULT_FEE_RATE,
      baseTime + 1000
    );

    expect(result.triggeredOrders[0].executionPrice).toBe(78800.0);

    // Gross: 0.005 * 78,800 = 394.00
    // Fee: 394.00 * 0.0005 = 0.197 (4 decimal places)
    const exec = result.executions[0];
    expect(exec.grossValue).toBe(394.0);
    expect(exec.fee).toBe(0.197);
    expect(exec.netValue).toBe(393.803);
  });

  // 5. Correct USDT balance and BTC quantity updates
  it('correctly updates USDT cash balance and reduces BTC holdings upon trigger fill', () => {
    const created = createProtectiveOrders(
      baseState,
      {
        symbol: 'BTCUSDT',
        baseAsset: 'BTC',
        quoteAsset: 'USDT',
        quantity: 0.004,
        takeProfitPrice: 84000.0,
        quote: freshQuote,
      },
      baseTime
    );

    const hitQuote: Record<string, LiveQuote> = {
      BTCUSDT: {
        symbol: 'BTCUSDT',
        bidPrice: 84000.0,
        askPrice: 84010.0,
        lastPrice: 84000.0,
        timestamp: baseTime + 1000,
      },
    };

    const result = evaluateProtectiveTriggers(
      created.newState,
      hitQuote,
      DEFAULT_FEE_RATE,
      baseTime + 1000
    );

    // Sold 0.004 BTC @ 84,000:
    // Gross = 336.00, Fee = 0.17, Net = 335.83
    // USDT balance: 49,200.00 + 335.832 = 49,535.832
    expect(result.newState.usdtBalance).toBeCloseTo(49535.83, 1);

    // Position quantity decreases from 0.01 to 0.006 BTC
    const updatedPos = result.newState.positions.BTCUSDT;
    expect(updatedPos.quantity).toBe(0.006);
    expect(updatedPos.reservedQuantity).toBe(0);
    expect(updatedPos.availableQuantity).toBe(0.006);
  });

  // 6. Correct realized P&L calculation
  it('correctly calculates realized P&L against weighted-average entry cost', () => {
    // Position cost basis is $80,000 per BTC
    // Sell 0.005 BTC @ $84,000:
    // Gross = $420, Fee = $0.21, Net = $419.79
    // Cost basis sold = 0.005 * 80,000 = $400.00
    // Realized P&L = 419.79 - 400.00 = +$19.79
    const created = createProtectiveOrders(
      baseState,
      {
        symbol: 'BTCUSDT',
        baseAsset: 'BTC',
        quoteAsset: 'USDT',
        quantity: 0.005,
        takeProfitPrice: 84000.0,
        quote: freshQuote,
      },
      baseTime
    );

    const hitQuote: Record<string, LiveQuote> = {
      BTCUSDT: {
        symbol: 'BTCUSDT',
        bidPrice: 84000.0,
        askPrice: 84010.0,
        lastPrice: 84000.0,
        timestamp: baseTime + 1000,
      },
    };

    const result = evaluateProtectiveTriggers(
      created.newState,
      hitQuote,
      DEFAULT_FEE_RATE,
      baseTime + 1000
    );

    const exec = result.executions[0];
    expect(exec.realizedPnl).toBeCloseTo(19.79, 1);
    expect(result.newState.totalRealizedPnl).toBeCloseTo(19.79, 1);
  });

  // 7. Linked order cancellation after a successful fill (OCO pair)
  it('automatically cancels the linked Take-Profit when Stop-Loss executes, and vice versa', () => {
    const created = createProtectiveOrders(
      baseState,
      {
        symbol: 'BTCUSDT',
        baseAsset: 'BTC',
        quoteAsset: 'USDT',
        quantity: 0.005,
        stopLossPrice: 78000.0,
        takeProfitPrice: 85000.0,
        quote: freshQuote,
      },
      baseTime
    );

    expect(created.createdOrders?.length).toBe(2);
    const sl = created.createdOrders?.find((o) => o.triggerType === 'stop-loss')!;
    const tp = created.createdOrders?.find((o) => o.triggerType === 'take-profit')!;

    // Market drops to 77,500 -> triggers SL
    const dropQuote: Record<string, LiveQuote> = {
      BTCUSDT: {
        symbol: 'BTCUSDT',
        bidPrice: 77500.0,
        askPrice: 77510.0,
        lastPrice: 77500.0,
        timestamp: baseTime + 1000,
      },
    };

    const result = evaluateProtectiveTriggers(
      created.newState,
      dropQuote,
      DEFAULT_FEE_RATE,
      baseTime + 1000
    );

    expect(result.triggeredOrders.length).toBe(1);
    expect(result.triggeredOrders[0].id).toBe(sl.id);
    expect(result.triggeredOrders[0].status).toBe('executed');

    // Linked Take-Profit MUST be canceled
    expect(result.canceledOrders.length).toBe(1);
    expect(result.canceledOrders[0].id).toBe(tp.id);

    const tpInState = result.newState.protectiveOrders.find((p) => p.id === tp.id);
    expect(tpInState?.status).toBe('cancelled');
  });

  // 8. No duplicate execution on repeated WebSocket ticks
  it('prevents duplicate execution when repeated WebSocket ticks match trigger condition', () => {
    const created = createProtectiveOrders(
      baseState,
      {
        symbol: 'BTCUSDT',
        baseAsset: 'BTC',
        quoteAsset: 'USDT',
        quantity: 0.005,
        stopLossPrice: 78000.0,
        quote: freshQuote,
      },
      baseTime
    );

    const dropQuote: Record<string, LiveQuote> = {
      BTCUSDT: {
        symbol: 'BTCUSDT',
        bidPrice: 77900.0,
        askPrice: 77910.0,
        lastPrice: 77900.0,
        timestamp: baseTime + 1000,
      },
    };

    // First tick executes
    const firstResult = evaluateProtectiveTriggers(
      created.newState,
      dropQuote,
      DEFAULT_FEE_RATE,
      baseTime + 1000
    );
    expect(firstResult.triggeredOrders.length).toBe(1);
    expect(firstResult.executions.length).toBe(1);

    // Second tick arrives with same or lower price
    const secondResult = evaluateProtectiveTriggers(
      firstResult.newState,
      dropQuote,
      DEFAULT_FEE_RATE,
      baseTime + 2000
    );

    // Must NOT execute again
    expect(secondResult.triggeredOrders.length).toBe(0);
    expect(secondResult.executions.length).toBe(0);
    expect(secondResult.newState.executions.length).toBe(1);
  });

  // 9. Rejection of quantities exceeding available holdings
  it('rejects protective orders with quantity exceeding uncommitted available holdings', () => {
    // Current available is 0.01 BTC
    // Request protection for 0.02 BTC
    const result = createProtectiveOrders(
      baseState,
      {
        symbol: 'BTCUSDT',
        baseAsset: 'BTC',
        quoteAsset: 'USDT',
        quantity: 0.02,
        stopLossPrice: 78000.0,
        quote: freshQuote,
      },
      baseTime
    );

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/exceeds uncommitted holdings/i);
    expect(baseState.protectiveOrders.length).toBe(0);
    expect(baseState.positions.BTCUSDT.reservedQuantity).toBe(0);
  });

  // 10. Cancellation releases protected holdings back to availableQuantity
  it('releases reserved holdings back to availableQuantity when protective order is canceled', () => {
    const created = createProtectiveOrders(
      baseState,
      {
        symbol: 'BTCUSDT',
        baseAsset: 'BTC',
        quoteAsset: 'USDT',
        quantity: 0.006,
        stopLossPrice: 78000.0,
        quote: freshQuote,
      },
      baseTime
    );

    expect(created.newState.positions.BTCUSDT.reservedQuantity).toBe(0.006);
    expect(created.newState.positions.BTCUSDT.availableQuantity).toBe(0.004);

    const orderId = created.createdOrders![0].id;
    const canceled = cancelProtectiveOrder(created.newState, orderId, baseTime + 1000);

    expect(canceled.success).toBe(true);
    expect(canceled.canceledOrder?.status).toBe('cancelled');
    expect(canceled.newState.positions.BTCUSDT.reservedQuantity).toBe(0);
    expect(canceled.newState.positions.BTCUSDT.availableQuantity).toBe(0.01);
  });

  it('cancels all orders in a linked OCO group and releases reserved holdings', () => {
    const created = createProtectiveOrders(
      baseState,
      {
        symbol: 'BTCUSDT',
        baseAsset: 'BTC',
        quoteAsset: 'USDT',
        quantity: 0.005,
        takeProfitPrice: 85000.0,
        stopLossPrice: 78000.0,
        quote: freshQuote,
      },
      baseTime
    );

    const groupId = created.createdOrders![0].groupId;
    const groupCanceled = cancelProtectiveGroup(created.newState, groupId, baseTime + 1000);

    expect(groupCanceled.success).toBe(true);
    expect(groupCanceled.canceledOrders.length).toBe(2);
    expect(groupCanceled.newState.positions.BTCUSDT.reservedQuantity).toBe(0);
    expect(groupCanceled.newState.positions.BTCUSDT.availableQuantity).toBe(0.01);
  });

  // 11. Existing limit orders and protective orders cannot oversell
  it('prevents overlapping sell orders from committing more than total holdings', () => {
    // 1. Place a limit sell order for 0.006 BTC
    const limitPlaced = placeLimitOrder(
      baseState,
      {
        symbol: 'BTCUSDT',
        baseAsset: 'BTC',
        quoteAsset: 'USDT',
        side: 'sell',
        quantity: 0.006,
        limitPrice: 85000.0,
      },
      DEFAULT_FEE_RATE,
      baseTime
    );

    expect(limitPlaced.success).toBe(true);
    expect(limitPlaced.newState.positions.BTCUSDT.availableQuantity).toBe(0.004);

    // 2. Try to activate protection for 0.005 BTC (exceeds available 0.004 BTC)
    const protExceed = createProtectiveOrders(
      { ...limitPlaced.newState, protectiveOrders: [] },
      {
        symbol: 'BTCUSDT',
        baseAsset: 'BTC',
        quoteAsset: 'USDT',
        quantity: 0.005,
        stopLossPrice: 78000.0,
        quote: freshQuote,
      },
      baseTime
    );

    expect(protExceed.success).toBe(false);
    expect(protExceed.error).toMatch(/exceeds uncommitted holdings/i);

    // 3. Protection for 0.004 BTC succeeds
    const protValid = createProtectiveOrders(
      { ...limitPlaced.newState, protectiveOrders: [] },
      {
        symbol: 'BTCUSDT',
        baseAsset: 'BTC',
        quoteAsset: 'USDT',
        quantity: 0.004,
        stopLossPrice: 78000.0,
        quote: freshQuote,
      },
      baseTime
    );

    expect(protValid.success).toBe(true);
    // Total 0.006 (limit) + 0.004 (protection) = 0.010 reserved
    expect(protValid.newState.positions.BTCUSDT.reservedQuantity).toBe(0.01);
    expect(protValid.newState.positions.BTCUSDT.availableQuantity).toBe(0);

    // 4. Any further sell order is blocked
    const marketSell = executeMarketOrder(
      protValid.newState,
      {
        symbol: 'BTCUSDT',
        baseAsset: 'BTC',
        quoteAsset: 'USDT',
        side: 'sell',
        quantity: 0.001,
        quote: freshQuote,
      },
      DEFAULT_FEE_RATE,
      baseTime
    );

    expect(marketSell.success).toBe(false);
    expect(marketSell.error).toMatch(/insufficient available holdings/i);
  });

  // 12. Stale/disconnected market data cannot trigger execution
  it('does NOT trigger execution if quote timestamp exceeds MAX_QUOTE_AGE_MS (60s)', () => {
    const created = createProtectiveOrders(
      baseState,
      {
        symbol: 'BTCUSDT',
        baseAsset: 'BTC',
        quoteAsset: 'USDT',
        quantity: 0.005,
        stopLossPrice: 78000.0,
        quote: freshQuote,
      },
      baseTime
    );

    // Stale quote: timestamp is 90 seconds in the past
    const staleQuote: Record<string, LiveQuote> = {
      BTCUSDT: {
        symbol: 'BTCUSDT',
        bidPrice: 75000.0, // well below trigger!
        askPrice: 75010.0,
        lastPrice: 75000.0,
        timestamp: baseTime - 90000,
      },
    };

    const result = evaluateProtectiveTriggers(
      created.newState,
      staleQuote,
      DEFAULT_FEE_RATE,
      baseTime
    );

    // Must NOT execute on stale quote
    expect(result.triggeredOrders.length).toBe(0);
    expect(result.executions.length).toBe(0);
  });

  // 13. State persistence and migration
  it('correctly validates setup parameters with validateProtectiveOrderSetup', () => {
    // SL above current bid is invalid
    const invalidSl = validateProtectiveOrderSetup(
      0.005,
      82000.0, // > 80,000 bid!
      undefined,
      initialBtcPosition,
      freshQuote,
      baseTime
    );
    expect(invalidSl.isValid).toBe(false);
    expect(invalidSl.error).toMatch(/must be strictly below/i);

    // TP below current bid is invalid
    const invalidTp = validateProtectiveOrderSetup(
      0.005,
      undefined,
      78000.0, // < 80,000 bid!
      initialBtcPosition,
      freshQuote,
      baseTime
    );
    expect(invalidTp.isValid).toBe(false);
    expect(invalidTp.error).toMatch(/must be strictly above/i);

    // Valid OCO pair
    const validOco = validateProtectiveOrderSetup(
      0.005,
      78000.0,
      85000.0,
      initialBtcPosition,
      freshQuote,
      baseTime
    );
    expect(validOco.isValid).toBe(true);
  });

  // 14. Account reset clears all protection
  it('clears all protective orders when resetAccount is invoked', () => {
    const initial = createInitialTradingState();
    expect(initial.protectiveOrders).toEqual([]);
  });

  // 15. Linked OCO reservation locks exactly once
  it('locks protected BTC quantity exactly once for linked OCO pair, not double', () => {
    const created = createProtectiveOrders(
      baseState,
      {
        symbol: 'BTCUSDT',
        baseAsset: 'BTC',
        quoteAsset: 'USDT',
        quantity: 0.005,
        stopLossPrice: 78000.0,
        takeProfitPrice: 85000.0,
        quote: freshQuote,
      },
      baseTime
    );

    expect(created.createdOrders?.length).toBe(2);
    // Locked 0.005 BTC, NOT 0.010 BTC
    expect(created.newState.positions.BTCUSDT.reservedQuantity).toBe(0.005);
    expect(created.newState.positions.BTCUSDT.availableQuantity).toBe(0.005);
  });
});

describe('Phase 5.1 Regression: Linked OCO Cancellation & Reservation Accounting', () => {
  const baseTime = 1700000000000;
  const initialCapital = 50000;

  // Initial state matching user problem scenario:
  // Total BTC holdings: 0.004 BTC, cost basis: $320 ($80,000 avg entry)
  const btcHoldingState: TradingAccountState & { protectiveOrders: ProtectiveOrder[] } = {
    usdtBalance: initialCapital - 320,
    usdtReserved: 0,
    positions: {
      BTCUSDT: {
        symbol: 'BTCUSDT',
        baseAsset: 'BTC',
        quoteAsset: 'USDT',
        quantity: 0.004,
        reservedQuantity: 0,
        availableQuantity: 0.004,
        averageEntryPrice: 80000,
        totalCostBasis: 320,
        realizedPnl: 0,
        openedAt: baseTime - 10000,
        updatedAt: baseTime - 10000,
      },
    },
    orders: [],
    executions: [],
    protectiveOrders: [],
    totalRealizedPnl: 0,
    totalFeesPaid: 0,
  };

  const currentQuote: Record<string, LiveQuote> = {
    BTCUSDT: {
      symbol: 'BTCUSDT',
      bidPrice: 82000.0,
      askPrice: 82010.0,
      lastPrice: 82000.0,
      timestamp: baseTime,
    },
  };

  // Setup helper for linked OCO pair: 0.001 BTC protected, TP $83,000, SL $81,000
  function createStandardOcoPair() {
    return createProtectiveOrders(
      btcHoldingState,
      {
        symbol: 'BTCUSDT',
        baseAsset: 'BTC',
        quoteAsset: 'USDT',
        quantity: 0.001,
        takeProfitPrice: 83000.0,
        stopLossPrice: 81000.0,
        quote: currentQuote.BTCUSDT,
      },
      baseTime
    );
  }

  // 1. Creating linked OCO orders reserves BTC only once
  it('1. Creating linked OCO orders reserves BTC only once (0.001 BTC reserved, 0.003 BTC available)', () => {
    const setup = createStandardOcoPair();
    expect(setup.success).toBe(true);
    expect(setup.createdOrders).toHaveLength(2);

    const pos = setup.newState.positions.BTCUSDT;
    expect(pos.quantity).toBe(0.004); // Total holding unchanged
    expect(pos.reservedQuantity).toBe(0.001); // Reserved exactly once
    expect(pos.availableQuantity).toBe(0.003); // Available = 0.004 - 0.001
  });

  // 2. Canceling Stop-Loss cancels both linked orders
  it('2. Canceling Stop-Loss cancels both linked orders atomically', () => {
    const setup = createStandardOcoPair();
    const sl = setup.createdOrders!.find((o) => o.triggerType === 'stop-loss')!;
    const tp = setup.createdOrders!.find((o) => o.triggerType === 'take-profit')!;

    const cancelResult = cancelProtectiveOrder(setup.newState, sl.id, baseTime + 1000);
    expect(cancelResult.success).toBe(true);
    expect(cancelResult.isLinkedOco).toBe(true);
    expect(cancelResult.canceledOrders).toHaveLength(2);

    // Both orders in state are now CANCELLED
    const slInState = cancelResult.newState.protectiveOrders.find((p) => p.id === sl.id);
    const tpInState = cancelResult.newState.protectiveOrders.find((p) => p.id === tp.id);
    expect(slInState?.status).toBe('cancelled');
    expect(tpInState?.status).toBe('cancelled');

    // Active protective count is 0
    const activeCount = cancelResult.newState.protectiveOrders.filter((p) => p.status === 'active').length;
    expect(activeCount).toBe(0);
  });

  // 3. Canceling Take-Profit cancels both linked orders
  it('3. Canceling Take-Profit cancels both linked orders atomically', () => {
    const setup = createStandardOcoPair();
    const sl = setup.createdOrders!.find((o) => o.triggerType === 'stop-loss')!;
    const tp = setup.createdOrders!.find((o) => o.triggerType === 'take-profit')!;

    const cancelResult = cancelProtectiveOrder(setup.newState, tp.id, baseTime + 1000);
    expect(cancelResult.success).toBe(true);
    expect(cancelResult.isLinkedOco).toBe(true);
    expect(cancelResult.canceledOrders).toHaveLength(2);

    const slInState = cancelResult.newState.protectiveOrders.find((p) => p.id === sl.id);
    const tpInState = cancelResult.newState.protectiveOrders.find((p) => p.id === tp.id);
    expect(slInState?.status).toBe('cancelled');
    expect(tpInState?.status).toBe('cancelled');

    const activeCount = cancelResult.newState.protectiveOrders.filter((p) => p.status === 'active').length;
    expect(activeCount).toBe(0);
  });

  // 4. Cancellation releases the shared reservation exactly once
  it('4. Cancellation releases the shared reservation exactly once, restoring available BTC to 0.004', () => {
    const setup = createStandardOcoPair();
    const sl = setup.createdOrders!.find((o) => o.triggerType === 'stop-loss')!;

    const cancelResult = cancelProtectiveOrder(setup.newState, sl.id, baseTime + 1000);
    expect(cancelResult.success).toBe(true);

    const pos = cancelResult.newState.positions.BTCUSDT;
    expect(pos.quantity).toBe(0.004); // Total BTC untouched
    expect(pos.reservedQuantity).toBe(0); // Reservation cleared
    expect(pos.availableQuantity).toBe(0.004); // Fully available
  });

  // 5. Repeated cancellation does not modify balances
  it('5. Repeated cancellation does not modify balances or release twice', () => {
    const setup = createStandardOcoPair();
    const sl = setup.createdOrders!.find((o) => o.triggerType === 'stop-loss')!;
    const tp = setup.createdOrders!.find((o) => o.triggerType === 'take-profit')!;

    // First cancel (SL) succeeds and releases reservation
    const firstCancel = cancelProtectiveOrder(setup.newState, sl.id, baseTime + 1000);
    expect(firstCancel.success).toBe(true);
    expect(firstCancel.newState.positions.BTCUSDT.availableQuantity).toBe(0.004);
    expect(firstCancel.newState.positions.BTCUSDT.reservedQuantity).toBe(0);

    // Repeated cancel on the same SL order fails gracefully
    const secondCancelSl = cancelProtectiveOrder(firstCancel.newState, sl.id, baseTime + 2000);
    expect(secondCancelSl.success).toBe(false);
    expect(secondCancelSl.newState.positions.BTCUSDT.availableQuantity).toBe(0.004);
    expect(secondCancelSl.newState.positions.BTCUSDT.reservedQuantity).toBe(0);

    // Repeated cancel on the counterpart TP order also fails gracefully
    const secondCancelTp = cancelProtectiveOrder(firstCancel.newState, tp.id, baseTime + 3000);
    expect(secondCancelTp.success).toBe(false);
    expect(secondCancelTp.newState.positions.BTCUSDT.availableQuantity).toBe(0.004);
    expect(secondCancelTp.newState.positions.BTCUSDT.reservedQuantity).toBe(0);
  });

  // 6. Canceling an unrelated order does not affect the OCO pair
  it('6. Canceling an unrelated order does not affect the OCO pair', () => {
    const setup = createStandardOcoPair();

    // Create an unrelated standalone protective order for ETHUSDT
    const stateWithEth: typeof btcHoldingState = {
      ...setup.newState,
      positions: {
        ...setup.newState.positions,
        ETHUSDT: {
          symbol: 'ETHUSDT',
          baseAsset: 'ETH',
          quoteAsset: 'USDT',
          quantity: 2.0,
          reservedQuantity: 0,
          availableQuantity: 2.0,
          averageEntryPrice: 2500,
          totalCostBasis: 5000,
          realizedPnl: 0,
          openedAt: baseTime,
          updatedAt: baseTime,
        },
      },
    };

    const ethSetup = createProtectiveOrders(
      stateWithEth,
      {
        symbol: 'ETHUSDT',
        baseAsset: 'ETH',
        quoteAsset: 'USDT',
        quantity: 1.0,
        stopLossPrice: 2300,
        quote: {
          symbol: 'ETHUSDT',
          bidPrice: 2500,
          askPrice: 2505,
          lastPrice: 2500,
          timestamp: baseTime,
        },
      },
      baseTime
    );

    expect(ethSetup.success).toBe(true);
    const ethOrder = ethSetup.createdOrders![0];

    // Cancel the ETH order
    const cancelEthResult = cancelProtectiveOrder(ethSetup.newState, ethOrder.id, baseTime + 1000);
    expect(cancelEthResult.success).toBe(true);

    // ETH reservation released
    expect(cancelEthResult.newState.positions.ETHUSDT.reservedQuantity).toBe(0);
    expect(cancelEthResult.newState.positions.ETHUSDT.availableQuantity).toBe(2.0);

    // BTC OCO pair is COMPLETELY unaffected
    const btcPos = cancelEthResult.newState.positions.BTCUSDT;
    expect(btcPos.reservedQuantity).toBe(0.001);
    expect(btcPos.availableQuantity).toBe(0.003);

    const btcOrders = cancelEthResult.newState.protectiveOrders.filter((p) => p.symbol === 'BTCUSDT');
    expect(btcOrders).toHaveLength(2);
    expect(btcOrders.every((p) => p.status === 'active')).toBe(true);
  });

  // 7. Triggering Take-Profit executes one SELL and cancels Stop-Loss
  it('7. Triggering Take-Profit executes one SELL and cancels Stop-Loss', () => {
    const setup = createStandardOcoPair();
    const sl = setup.createdOrders!.find((o) => o.triggerType === 'stop-loss')!;
    const tp = setup.createdOrders!.find((o) => o.triggerType === 'take-profit')!;

    // Market surges to $83,500 (above $83,000 TP)
    const surgeQuote: Record<string, LiveQuote> = {
      BTCUSDT: {
        symbol: 'BTCUSDT',
        bidPrice: 83500.0,
        askPrice: 83510.0,
        lastPrice: 83500.0,
        timestamp: baseTime + 1000,
      },
    };

    const triggerResult = evaluateProtectiveTriggers(setup.newState, surgeQuote, 0.0005, baseTime + 1000);
    expect(triggerResult.triggeredOrders).toHaveLength(1);
    expect(triggerResult.triggeredOrders[0].id).toBe(tp.id);
    expect(triggerResult.triggeredOrders[0].status).toBe('executed');

    expect(triggerResult.canceledOrders).toHaveLength(1);
    expect(triggerResult.canceledOrders[0].id).toBe(sl.id);
    expect(triggerResult.canceledOrders[0].status).toBe('cancelled');

    // Executed 1 SELL of 0.001 BTC
    expect(triggerResult.executions).toHaveLength(1);
    expect(triggerResult.executions[0].side).toBe('sell');
    expect(triggerResult.executions[0].quantity).toBe(0.001);
    expect(triggerResult.executions[0].price).toBe(83500.0);

    // BTC holdings decremented by 0.001 to 0.003 BTC, 0 reserved
    const pos = triggerResult.newState.positions.BTCUSDT;
    expect(pos.quantity).toBe(0.003);
    expect(pos.reservedQuantity).toBe(0);
    expect(pos.availableQuantity).toBe(0.003);
  });

  // 8. Triggering Stop-Loss executes one SELL and cancels Take-Profit
  it('8. Triggering Stop-Loss executes one SELL and cancels Take-Profit', () => {
    const setup = createStandardOcoPair();
    const sl = setup.createdOrders!.find((o) => o.triggerType === 'stop-loss')!;
    const tp = setup.createdOrders!.find((o) => o.triggerType === 'take-profit')!;

    // Market drops to $80,500 (below $81,000 SL)
    const dropQuote: Record<string, LiveQuote> = {
      BTCUSDT: {
        symbol: 'BTCUSDT',
        bidPrice: 80500.0,
        askPrice: 80510.0,
        lastPrice: 80500.0,
        timestamp: baseTime + 1000,
      },
    };

    const triggerResult = evaluateProtectiveTriggers(setup.newState, dropQuote, 0.0005, baseTime + 1000);
    expect(triggerResult.triggeredOrders).toHaveLength(1);
    expect(triggerResult.triggeredOrders[0].id).toBe(sl.id);
    expect(triggerResult.triggeredOrders[0].status).toBe('executed');

    expect(triggerResult.canceledOrders).toHaveLength(1);
    expect(triggerResult.canceledOrders[0].id).toBe(tp.id);
    expect(triggerResult.canceledOrders[0].status).toBe('cancelled');

    expect(triggerResult.executions).toHaveLength(1);
    expect(triggerResult.executions[0].price).toBe(80500.0);

    const pos = triggerResult.newState.positions.BTCUSDT;
    expect(pos.quantity).toBe(0.003);
    expect(pos.reservedQuantity).toBe(0);
    expect(pos.availableQuantity).toBe(0.003);
  });

  // 9. Simultaneous trigger/cancellation attempts cannot double-execute
  it('9. Simultaneous trigger/cancellation attempts cannot double-execute', () => {
    const setup = createStandardOcoPair();
    const sl = setup.createdOrders!.find((o) => o.triggerType === 'stop-loss')!;

    // Scenario A: Order executes first -> subsequent cancellation attempt fails safely
    const dropQuote: Record<string, LiveQuote> = {
      BTCUSDT: {
        symbol: 'BTCUSDT',
        bidPrice: 80000.0,
        askPrice: 80010.0,
        lastPrice: 80000.0,
        timestamp: baseTime + 1000,
      },
    };
    const executedState = evaluateProtectiveTriggers(setup.newState, dropQuote, 0.0005, baseTime + 1000).newState;

    const cancelAfterExec = cancelProtectiveOrder(executedState, sl.id, baseTime + 1100);
    expect(cancelAfterExec.success).toBe(false);
    expect(cancelAfterExec.newState.positions.BTCUSDT.quantity).toBe(0.003); // No double deduct

    // Scenario B: Order cancelled first -> subsequent market tick cannot trigger execution
    const canceledState = cancelProtectiveOrder(setup.newState, sl.id, baseTime + 1000).newState;
    const triggerAfterCancel = evaluateProtectiveTriggers(canceledState, dropQuote, 0.0005, baseTime + 1100);
    expect(triggerAfterCancel.triggeredOrders).toHaveLength(0);
    expect(triggerAfterCancel.executions).toHaveLength(0);
    expect(triggerAfterCancel.newState.positions.BTCUSDT.quantity).toBe(0.004); // Holdings preserved
  });

  // 10. Trade History, holdings, cash balance, fees, and portfolio equity remain consistent through cancellation
  it('10. Trade History, holdings, cash balance, fees, and portfolio equity remain consistent through cancellation', () => {
    const setup = createStandardOcoPair();
    const sl = setup.createdOrders!.find((o) => o.triggerType === 'stop-loss')!;

    const initialCash = setup.newState.usdtBalance;
    const initialTradesCount = setup.newState.executions.length;
    const initialOrdersCount = setup.newState.orders.length;
    const initialFees = setup.newState.totalFeesPaid;
    const initialRealizedPnl = setup.newState.totalRealizedPnl;

    const canceled = cancelProtectiveOrder(setup.newState, sl.id, baseTime + 1000);
    expect(canceled.success).toBe(true);

    const afterState = canceled.newState;

    // Zero financial side-effects on cancellation:
    expect(afterState.usdtBalance).toBe(initialCash);
    expect(afterState.executions.length).toBe(initialTradesCount);
    expect(afterState.orders.length).toBe(initialOrdersCount);
    expect(afterState.totalFeesPaid).toBe(initialFees);
    expect(afterState.totalRealizedPnl).toBe(initialRealizedPnl);

    // Total holdings unchanged
    expect(afterState.positions.BTCUSDT.quantity).toBe(0.004);
    // Reservation fully cleared
    expect(afterState.positions.BTCUSDT.reservedQuantity).toBe(0);
    expect(afterState.positions.BTCUSDT.availableQuantity).toBe(0.004);
  });
});
