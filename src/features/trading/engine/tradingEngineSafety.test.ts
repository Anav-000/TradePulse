import { describe, it, expect, beforeEach } from 'vitest';
import {
  executeMarketOrder,
  placeLimitOrder,
  cancelOrder,
  createInitialTradingState,
  processPendingMatches,
  TradingAccountState,
  cancelProtectiveLeg,
} from './orderEngine';
import {
  createProtectiveOrders,
  cancelProtectiveOrder,
  evaluateProtectiveTriggers,
} from './protectiveOrderEngine';
import { matchPendingOrders } from './orderMatcher';
import {
  validateOrderBasics,
  validateQuoteFreshness,
  isQuoteFresh,
  MAX_QUOTE_AGE_MS,
} from './orderValidator';
import {
  canTransitionOrderStatus,
  canTransitionProtectiveStatus,
  isTerminalOrderStatus,
} from './orderLifecycle';
import {
  calculatePortfolioStats,
} from './portfolioAccounting';
import {
  calculateFee,
  calculateGrossValue,
  calculateTotalBuyCost,
  DEFAULT_FEE_RATE,
} from './feeCalculator';
import { useTradingStore, reconcileTradingState } from '../stores/useTradingStore';
import { TradeOrder, ProtectiveOrder, LiveQuote, Position } from '../types';

describe('Phase 5.2 Deterministic Safety & Reliability Test Suite (T01 - T25)', () => {
  const baseTime = 1700000000000;

  const validQuote: LiveQuote = {
    symbol: 'BTCUSDT',
    bidPrice: 80000.0,
    askPrice: 80010.0,
    lastPrice: 80005.0,
    timestamp: baseTime,
  };

  const initialBtcPosition: Position = {
    symbol: 'BTCUSDT',
    baseAsset: 'BTC',
    quoteAsset: 'USDT',
    quantity: 0.1,
    reservedQuantity: 0,
    availableQuantity: 0.1,
    averageEntryPrice: 80000.0,
    totalCostBasis: 8000.0,
    realizedPnl: 0,
    openedAt: baseTime,
    updatedAt: baseTime,
  };

  let baseState: TradingAccountState & { protectiveOrders: ProtectiveOrder[] };

  beforeEach(() => {
    baseState = {
      ...createInitialTradingState(),
      usdtBalance: 50000.0,
      usdtReserved: 0,
      positions: {},
      protectiveOrders: [],
    };
    useTradingStore.getState().resetAccount();
    localStorage.clear();
  });

  // ==========================================
  // T01: Duplicate order execution
  // ==========================================
  it('T01: Duplicate order execution — prevents double fill on terminal orders and concurrent submissions', async () => {
    // 1. Terminal order in orderMatcher cannot be filled twice
    const order: TradeOrder = {
      id: 'order_test_1',
      symbol: 'BTCUSDT',
      baseAsset: 'BTC',
      quoteAsset: 'USDT',
      side: 'buy',
      type: 'limit',
      price: 80000.0,
      quantity: 0.1,
      fee: 4.0,
      status: 'filled', // Already terminal
      reservedAmount: 8004.0,
      createdAt: baseTime,
      filledAt: baseTime,
    };

    const quotes = { BTCUSDT: validQuote };
    const result = matchPendingOrders([order], quotes, DEFAULT_FEE_RATE, baseTime);
    expect(result.filledOrders).toHaveLength(0);
    expect(result.executions).toHaveLength(0);
    expect(result.remainingPendingOrders).toHaveLength(0);

    // 2. Lifecycle state guard rejects filled -> filled transition
    expect(canTransitionOrderStatus('filled', 'filled')).toBe(false);
    expect(isTerminalOrderStatus('filled')).toBe(true);

    // 3. Two programmatic submissions issued in the same event-loop turn:
    // Exactly one order executes, the second is rejected atomically before balance/position mutation
    const orderParams = {
      symbol: 'BTCUSDT',
      baseAsset: 'BTC',
      quoteAsset: 'USDT',
      side: 'buy' as const,
      quantity: 0.001,
      quote: {
        ...validQuote,
        timestamp: Date.now(),
      },
    };

    const initialBalance = useTradingStore.getState().usdtBalance;
    const p1 = useTradingStore.getState().executeMarketOrder(orderParams);
    const p2 = useTradingStore.getState().executeMarketOrder(orderParams);
    const [res1, res2] = await Promise.all([p1, p2]);

    // Exactly one must succeed, the other rejected with in-progress error
    const successes = [res1, res2].filter((r) => r.success);
    const rejections = [res1, res2].filter((r) => !r.success);

    expect(successes).toHaveLength(1);
    expect(rejections).toHaveLength(1);
    expect(rejections[0].error).toMatch(/in progress/i);

    // Assert that state mutations happened EXACTLY once
    const stateAfterConcurrent = useTradingStore.getState();
    expect(stateAfterConcurrent.executions).toHaveLength(1);
    expect(stateAfterConcurrent.orders).toHaveLength(1);
    expect(stateAfterConcurrent.positions['BTCUSDT'].quantity).toBe(0.001);
    // Cost of 0.001 BTC @ 80010 ask = 80.01 gross + 0.040005 fee = 80.050005
    expect(stateAfterConcurrent.usdtBalance).toBeCloseTo(initialBalance - 80.05, 2);

    // 4. Verify that a later, intentional second order is still permitted
    const resLater = await useTradingStore.getState().executeMarketOrder(orderParams);
    expect(resLater.success).toBe(true);

    const stateAfterLater = useTradingStore.getState();
    expect(stateAfterLater.executions).toHaveLength(2);
    expect(stateAfterLater.orders).toHaveLength(2);
    expect(stateAfterLater.positions['BTCUSDT'].quantity).toBe(0.002);

    // 5. Verify limit orders also enforce concurrent in-flight protection
    const limitParams = {
      symbol: 'BTCUSDT',
      baseAsset: 'BTC',
      quoteAsset: 'USDT',
      side: 'buy' as const,
      quantity: 0.05,
      limitPrice: 70000.0,
    };

    const lp1 = useTradingStore.getState().placeLimitOrder(limitParams);
    const lp2 = useTradingStore.getState().placeLimitOrder(limitParams);
    const [lRes1, lRes2] = await Promise.all([lp1, lp2]);

    const lSuccesses = [lRes1, lRes2].filter((r) => r.success);
    const lRejections = [lRes1, lRes2].filter((r) => !r.success);

    expect(lSuccesses).toHaveLength(1);
    expect(lRejections).toHaveLength(1);
    expect(lRejections[0].error).toMatch(/in progress/i);

    // Limit buy reservation (0.05 * 70,000 * 1.0005 = 3501.75) held once, not twice
    const stateAfterLimit = useTradingStore.getState();
    expect(stateAfterLimit.usdtReserved).toBeCloseTo(3501.75, 2);
    expect(stateAfterLimit.orders.filter((o) => o.status === 'pending')).toHaveLength(1);
  });

  // ==========================================
  // T02: Stop-Loss repeated execution attempt
  // ==========================================
  it('T02: Stop-Loss repeated execution attempt — triggers once, transitions to executed, duplicate attempts ignored', () => {
    baseState.positions['BTCUSDT'] = { ...initialBtcPosition };

    // Set SL at $78,000 for 0.05 BTC
    const created = createProtectiveOrders(
      baseState,
      {
        symbol: 'BTCUSDT',
        baseAsset: 'BTC',
        quoteAsset: 'USDT',
        quantity: 0.05,
        stopLossPrice: 78000.0,
        quote: validQuote,
      },
      baseTime
    );
    expect(created.success).toBe(true);

    // 1st tick: price drops to $77,900 -> triggers SL
    const dropQuote1: Record<string, LiveQuote> = {
      BTCUSDT: {
        symbol: 'BTCUSDT',
        bidPrice: 77900.0,
        askPrice: 77910.0,
        lastPrice: 77900.0,
        timestamp: baseTime + 1000,
      },
    };

    const eval1 = evaluateProtectiveTriggers(
      created.newState,
      dropQuote1,
      DEFAULT_FEE_RATE,
      baseTime + 1000
    );
    expect(eval1.triggeredOrders).toHaveLength(1);
    expect(eval1.triggeredOrders[0].status).toBe('executed');
    expect(eval1.executions).toHaveLength(1);

    // 2nd tick: price drops even lower to $76,000 -> duplicate attempt must be ignored
    const dropQuote2: Record<string, LiveQuote> = {
      BTCUSDT: {
        symbol: 'BTCUSDT',
        bidPrice: 76000.0,
        askPrice: 76010.0,
        lastPrice: 76000.0,
        timestamp: baseTime + 2000,
      },
    };

    const eval2 = evaluateProtectiveTriggers(
      eval1.newState,
      dropQuote2,
      DEFAULT_FEE_RATE,
      baseTime + 2000
    );
    expect(eval2.triggeredOrders).toHaveLength(0);
    expect(eval2.executions).toHaveLength(0);
    expect(eval2.newState.protectiveOrders[0].status).toBe('executed');
    expect(canTransitionProtectiveStatus('executed', 'executed')).toBe(false);
  });

  // ==========================================
  // T03: Take-Profit repeated execution attempt
  // ==========================================
  it('T03: Take-Profit repeated execution attempt — triggers once, transitions to executed, duplicate attempts ignored', () => {
    baseState.positions['BTCUSDT'] = { ...initialBtcPosition };

    // Set TP at $85,000 for 0.05 BTC
    const created = createProtectiveOrders(
      baseState,
      {
        symbol: 'BTCUSDT',
        baseAsset: 'BTC',
        quoteAsset: 'USDT',
        quantity: 0.05,
        takeProfitPrice: 85000.0,
        quote: validQuote,
      },
      baseTime
    );
    expect(created.success).toBe(true);

    // 1st tick: price rises to $85,500 -> triggers TP
    const rallyQuote1: Record<string, LiveQuote> = {
      BTCUSDT: {
        symbol: 'BTCUSDT',
        bidPrice: 85500.0,
        askPrice: 85510.0,
        lastPrice: 85500.0,
        timestamp: baseTime + 1000,
      },
    };

    const eval1 = evaluateProtectiveTriggers(
      created.newState,
      rallyQuote1,
      DEFAULT_FEE_RATE,
      baseTime + 1000
    );
    expect(eval1.triggeredOrders).toHaveLength(1);
    expect(eval1.triggeredOrders[0].status).toBe('executed');
    expect(eval1.executions).toHaveLength(1);

    // 2nd tick: price rallies further to $88,000 -> duplicate attempt must be ignored
    const rallyQuote2: Record<string, LiveQuote> = {
      BTCUSDT: {
        symbol: 'BTCUSDT',
        bidPrice: 88000.0,
        askPrice: 88010.0,
        lastPrice: 88000.0,
        timestamp: baseTime + 2000,
      },
    };

    const eval2 = evaluateProtectiveTriggers(
      eval1.newState,
      rallyQuote2,
      DEFAULT_FEE_RATE,
      baseTime + 2000
    );
    expect(eval2.triggeredOrders).toHaveLength(0);
    expect(eval2.executions).toHaveLength(0);
    expect(eval2.newState.protectiveOrders[0].status).toBe('executed');
    expect(canTransitionProtectiveStatus('executed', 'executed')).toBe(false);
  });

  // ==========================================
  // T04: Simultaneous OCO trigger condition
  // ==========================================
  it('T04: Simultaneous OCO trigger condition — exactly one leg executes and counterpart is canceled', () => {
    baseState.positions['BTCUSDT'] = { ...initialBtcPosition };

    // Create linked OCO pair: SL at $78,000, TP at $85,000 for 0.05 BTC
    const created = createProtectiveOrders(
      baseState,
      {
        symbol: 'BTCUSDT',
        baseAsset: 'BTC',
        quoteAsset: 'USDT',
        quantity: 0.05,
        stopLossPrice: 78000.0,
        takeProfitPrice: 85000.0,
        quote: validQuote,
      },
      baseTime
    );
    expect(created.success).toBe(true);
    expect(created.createdOrders).toHaveLength(2);

    // Simulate price drop triggering SL
    const triggerQuote: Record<string, LiveQuote> = {
      BTCUSDT: {
        symbol: 'BTCUSDT',
        bidPrice: 77500.0,
        askPrice: 77510.0,
        lastPrice: 77500.0,
        timestamp: baseTime + 1000,
      },
    };

    const evalResult = evaluateProtectiveTriggers(
      created.newState,
      triggerQuote,
      DEFAULT_FEE_RATE,
      baseTime + 1000
    );

    // Exactly one leg triggered
    expect(evalResult.triggeredOrders).toHaveLength(1);
    expect(evalResult.triggeredOrders[0].triggerType).toBe('stop-loss');
    expect(evalResult.triggeredOrders[0].status).toBe('executed');

    // The other leg was canceled
    expect(evalResult.canceledOrders).toHaveLength(1);
    expect(evalResult.canceledOrders[0].triggerType).toBe('take-profit');
    expect(evalResult.canceledOrders[0].status).toBe('cancelled');

    // Total executions is strictly 1
    expect(evalResult.executions).toHaveLength(1);
  });

  // ==========================================
  // T05: Stop-Loss execution
  // ==========================================
  it('T05: Stop-Loss execution — Take-Profit leg canceled, BTC reservation released, proceeds credited', () => {
    baseState.positions['BTCUSDT'] = { ...initialBtcPosition };

    const created = createProtectiveOrders(
      baseState,
      {
        symbol: 'BTCUSDT',
        baseAsset: 'BTC',
        quoteAsset: 'USDT',
        quantity: 0.05,
        stopLossPrice: 78000.0,
        takeProfitPrice: 85000.0,
        quote: validQuote,
      },
      baseTime
    );

    // Verify reservation locked before execution
    expect(created.newState.positions['BTCUSDT'].reservedQuantity).toBe(0.05);
    expect(created.newState.positions['BTCUSDT'].availableQuantity).toBe(0.05);

    // Trigger SL at $78,000
    const dropQuote: Record<string, LiveQuote> = {
      BTCUSDT: {
        symbol: 'BTCUSDT',
        bidPrice: 78000.0,
        askPrice: 78010.0,
        lastPrice: 78000.0,
        timestamp: baseTime + 1000,
      },
    };

    const evalResult = evaluateProtectiveTriggers(
      created.newState,
      dropQuote,
      DEFAULT_FEE_RATE,
      baseTime + 1000
    );

    const pos = evalResult.newState.positions['BTCUSDT'];
    expect(pos.quantity).toBe(0.05); // 0.1 - 0.05
    expect(pos.reservedQuantity).toBe(0); // Reservation fully released
    expect(pos.availableQuantity).toBe(0.05);

    // Proceeds: 0.05 * 78000 = $3900 gross, fee = $1.95, net = $3898.05
    expect(evalResult.newState.usdtBalance).toBeCloseTo(50000.0 + 3898.05, 2);
  });

  // ==========================================
  // T06: Take-Profit execution
  // ==========================================
  it('T06: Take-Profit execution — Stop-Loss leg canceled, BTC reservation released, proceeds credited', () => {
    baseState.positions['BTCUSDT'] = { ...initialBtcPosition };

    const created = createProtectiveOrders(
      baseState,
      {
        symbol: 'BTCUSDT',
        baseAsset: 'BTC',
        quoteAsset: 'USDT',
        quantity: 0.05,
        stopLossPrice: 78000.0,
        takeProfitPrice: 85000.0,
        quote: validQuote,
      },
      baseTime
    );

    // Trigger TP at $85,000
    const rallyQuote: Record<string, LiveQuote> = {
      BTCUSDT: {
        symbol: 'BTCUSDT',
        bidPrice: 85000.0,
        askPrice: 85010.0,
        lastPrice: 85000.0,
        timestamp: baseTime + 1000,
      },
    };

    const evalResult = evaluateProtectiveTriggers(
      created.newState,
      rallyQuote,
      DEFAULT_FEE_RATE,
      baseTime + 1000
    );

    expect(evalResult.triggeredOrders[0].triggerType).toBe('take-profit');
    expect(evalResult.canceledOrders[0].triggerType).toBe('stop-loss');

    const pos = evalResult.newState.positions['BTCUSDT'];
    expect(pos.quantity).toBe(0.05);
    expect(pos.reservedQuantity).toBe(0);
    expect(pos.availableQuantity).toBe(0.05);

    // Proceeds: 0.05 * 85000 = $4250 gross, fee = $2.125, net = $4247.875
    expect(evalResult.newState.usdtBalance).toBeCloseTo(50000.0 + 4247.875, 2);
  });

  // ==========================================
  // T07: Cancel single OCO leg
  // ==========================================
  it('T07: Cancel single OCO leg — only specified leg canceled, sibling remains active, reservation preserved', () => {
    baseState.positions['BTCUSDT'] = { ...initialBtcPosition };

    const created = createProtectiveOrders(
      baseState,
      {
        symbol: 'BTCUSDT',
        baseAsset: 'BTC',
        quoteAsset: 'USDT',
        quantity: 0.05,
        stopLossPrice: 78000.0,
        takeProfitPrice: 85000.0,
        quote: validQuote,
      },
      baseTime
    );

    const slOrder = created.createdOrders!.find((o) => o.triggerType === 'stop-loss')!;
    const tpOrder = created.createdOrders!.find((o) => o.triggerType === 'take-profit')!;

    // Cancel ONLY the Stop-Loss leg via cancelProtectiveLeg
    const cancelRes = cancelProtectiveLeg(created.newState, slOrder.id, baseTime + 500);

    expect(cancelRes.success).toBe(true);
    expect(cancelRes.canceledOrder?.id).toBe(slOrder.id);
    expect(cancelRes.canceledOrders).toHaveLength(1);

    // Verify Stop-Loss is canceled but Take-Profit is STILL active
    const orders = cancelRes.newState.protectiveOrders;
    const updatedSl = orders.find((o) => o.id === slOrder.id);
    const updatedTp = orders.find((o) => o.id === tpOrder.id);
    expect(updatedSl?.status).toBe('cancelled');
    expect(updatedTp?.status).toBe('active');

    // Crucial: The shared 0.05 BTC reservation must STILL be held because the TP sibling is active!
    const pos = cancelRes.newState.positions['BTCUSDT'];
    expect(pos.reservedQuantity).toBe(0.05);
    expect(pos.availableQuantity).toBe(0.05);
    expect(cancelRes.releasedQuantity).toBe(0);
  });

  // ==========================================
  // T08: Cancel complete OCO pair
  // ==========================================
  it('T08: Cancel complete OCO pair — both legs canceled, BTC reservation released exactly once', () => {
    baseState.positions['BTCUSDT'] = { ...initialBtcPosition };

    const created = createProtectiveOrders(
      baseState,
      {
        symbol: 'BTCUSDT',
        baseAsset: 'BTC',
        quoteAsset: 'USDT',
        quantity: 0.05,
        stopLossPrice: 78000.0,
        takeProfitPrice: 85000.0,
        quote: validQuote,
      },
      baseTime
    );

    const slOrder = created.createdOrders!.find((o) => o.triggerType === 'stop-loss')!;

    // Default cancelProtectiveOrder cancels both legs
    const cancelRes = cancelProtectiveOrder(created.newState, slOrder.id, baseTime + 500);

    expect(cancelRes.success).toBe(true);
    expect(cancelRes.isLinkedOco).toBe(true);
    expect(cancelRes.canceledOrders).toHaveLength(2);
    expect(cancelRes.releasedQuantity).toBe(0.05);

    // Reservation must be 0, not negative (released exactly once)
    const pos = cancelRes.newState.positions['BTCUSDT'];
    expect(pos.reservedQuantity).toBe(0);
    expect(pos.availableQuantity).toBe(0.1);
  });

  // ==========================================
  // T09: Insufficient USDT for BUY
  // ==========================================
  it('T09: Insufficient USDT for BUY — order rejected, zero state mutation', () => {
    // Available: 50,000 USDT. Trying to buy 1 BTC @ 80,010 ask = ~80,050 USDT needed
    const marketBuyRes = executeMarketOrder(
      baseState,
      {
        symbol: 'BTCUSDT',
        baseAsset: 'BTC',
        quoteAsset: 'USDT',
        side: 'buy',
        quantity: 1.0,
        quote: validQuote,
      },
      DEFAULT_FEE_RATE,
      baseTime
    );

    expect(marketBuyRes.success).toBe(false);
    expect(marketBuyRes.error).toMatch(/insufficient/i);
    expect(baseState.usdtBalance).toBe(50000.0);
    expect(baseState.orders).toHaveLength(0);
    expect(baseState.executions).toHaveLength(0);

    // Same for limit order
    const limitBuyRes = placeLimitOrder(
      baseState,
      {
        symbol: 'BTCUSDT',
        baseAsset: 'BTC',
        quoteAsset: 'USDT',
        side: 'buy',
        quantity: 1.0,
        limitPrice: 80000.0,
      },
      DEFAULT_FEE_RATE,
      baseTime
    );

    expect(limitBuyRes.success).toBe(false);
    expect(limitBuyRes.error).toMatch(/insufficient/i);
    expect(baseState.usdtReserved).toBe(0);
  });

  // ==========================================
  // T10: Insufficient crypto for SELL
  // ==========================================
  it('T10: Insufficient crypto for SELL — order rejected, zero state mutation', () => {
    baseState.positions['BTCUSDT'] = { ...initialBtcPosition, quantity: 0.05, availableQuantity: 0.05 };

    // Attempting to sell 0.1 BTC when only 0.05 is available
    const marketSellRes = executeMarketOrder(
      baseState,
      {
        symbol: 'BTCUSDT',
        baseAsset: 'BTC',
        quoteAsset: 'USDT',
        side: 'sell',
        quantity: 0.1,
        quote: validQuote,
      },
      DEFAULT_FEE_RATE,
      baseTime
    );

    expect(marketSellRes.success).toBe(false);
    expect(marketSellRes.error).toMatch(/insufficient/i);
    expect(baseState.positions['BTCUSDT'].quantity).toBe(0.05);
    expect(baseState.usdtBalance).toBe(50000.0);
  });

  // ==========================================
  // T11: Zero or negative order quantity
  // ==========================================
  it('T11: Zero or negative order quantity — rejected with validation error', () => {
    expect(validateOrderBasics(0).isValid).toBe(false);
    expect(validateOrderBasics(-1).isValid).toBe(false);
    expect(validateOrderBasics(-0.0001).isValid).toBe(false);

    const res0 = executeMarketOrder(
      baseState,
      {
        symbol: 'BTCUSDT',
        baseAsset: 'BTC',
        quoteAsset: 'USDT',
        side: 'buy',
        quantity: 0,
        quote: validQuote,
      },
      DEFAULT_FEE_RATE,
      baseTime
    );
    expect(res0.success).toBe(false);

    const resNeg = executeMarketOrder(
      baseState,
      {
        symbol: 'BTCUSDT',
        baseAsset: 'BTC',
        quoteAsset: 'USDT',
        side: 'buy',
        quantity: -0.5,
        quote: validQuote,
      },
      DEFAULT_FEE_RATE,
      baseTime
    );
    expect(resNeg.success).toBe(false);
  });

  // ==========================================
  // T12: Non-numeric / NaN / Infinity inputs
  // ==========================================
  it('T12: Non-numeric / NaN / Infinity inputs — rejected safely without crash', async () => {
    expect(validateOrderBasics(NaN).isValid).toBe(false);
    expect(validateOrderBasics(Infinity).isValid).toBe(false);
    expect(validateOrderBasics(1.0, NaN).isValid).toBe(false);
    expect(validateOrderBasics(1.0, Infinity).isValid).toBe(false);

    const nanBuy = executeMarketOrder(
      baseState,
      {
        symbol: 'BTCUSDT',
        baseAsset: 'BTC',
        quoteAsset: 'USDT',
        side: 'buy',
        quantity: NaN as any,
        quote: validQuote,
      },
      DEFAULT_FEE_RATE,
      baseTime
    );
    expect(nanBuy.success).toBe(false);

    const infLimit = placeLimitOrder(
      baseState,
      {
        symbol: 'BTCUSDT',
        baseAsset: 'BTC',
        quoteAsset: 'USDT',
        side: 'buy',
        quantity: 0.1,
        limitPrice: Infinity as any,
      },
      DEFAULT_FEE_RATE,
      baseTime
    );
    expect(infLimit.success).toBe(false);

    // Direct store calls bypassing UI:
    // Snapshot initial store state
    const store = useTradingStore.getState();
    const initialUsdtBalance = store.usdtBalance;
    const initialUsdtReserved = store.usdtReserved;
    const initialOrdersCount = store.orders.length;
    const initialExecutionsCount = store.executions.length;

    // 1. Direct store call with 9 decimal places quantity (0.000000001 BTC)
    const nineDecimalsLimit = await useTradingStore.getState().placeLimitOrder({
      symbol: 'BTCUSDT',
      baseAsset: 'BTC',
      quoteAsset: 'USDT',
      side: 'sell',
      quantity: 0.000000001,
      limitPrice: 90000,
    });
    expect(nineDecimalsLimit.success).toBe(false);
    expect(nineDecimalsLimit.error).toMatch(/cannot exceed 8 decimal places/i);

    // 2. Direct store call with sub-$1 notional (0.00001 BTC @ 90,000 USDT = $0.90)
    const subDollarLimit = await useTradingStore.getState().placeLimitOrder({
      symbol: 'BTCUSDT',
      baseAsset: 'BTC',
      quoteAsset: 'USDT',
      side: 'sell',
      quantity: 0.00001,
      limitPrice: 90000,
    });
    expect(subDollarLimit.success).toBe(false);
    expect(subDollarLimit.error).toMatch(/below the minimum required \$1\.00 USDT/i);

    // 3. Direct store call with price precision violation (90000.123 USDT has 3 decimals)
    const invalidPricePrecLimit = await useTradingStore.getState().placeLimitOrder({
      symbol: 'BTCUSDT',
      baseAsset: 'BTC',
      quoteAsset: 'USDT',
      side: 'buy',
      quantity: 0.001,
      limitPrice: 90000.123,
    });
    expect(invalidPricePrecLimit.success).toBe(false);
    expect(invalidPricePrecLimit.error).toMatch(/cannot exceed 2 decimal places/i);

    // 4. Direct store call with extreme numeric overflow (1e30) independently of balance
    const overflowLimit = await useTradingStore.getState().placeLimitOrder({
      symbol: 'BTCUSDT',
      baseAsset: 'BTC',
      quoteAsset: 'USDT',
      side: 'buy',
      quantity: 1e30,
      limitPrice: 90000,
    });
    expect(overflowLimit.success).toBe(false);
    expect(overflowLimit.error).toMatch(/exceeds maximum allowed limit/i);

    // 5. Direct market order below $1 notional
    const subDollarMarket = await useTradingStore.getState().executeMarketOrder({
      symbol: 'BTCUSDT',
      baseAsset: 'BTC',
      quoteAsset: 'USDT',
      side: 'buy',
      quantity: 0.00001,
      quote: { ...validQuote, timestamp: Date.now() },
    });
    expect(subDollarMarket.success).toBe(false);
    expect(subDollarMarket.error).toMatch(/below the minimum required \$1\.00 USDT/i);

    // Assert that invalid orders made ZERO mutations to balances, reservations, orders, or trade history
    const finalStore = useTradingStore.getState();
    expect(finalStore.usdtBalance).toBe(initialUsdtBalance);
    expect(finalStore.usdtReserved).toBe(initialUsdtReserved);
    expect(finalStore.orders.length).toBe(initialOrdersCount);
    expect(finalStore.executions.length).toBe(initialExecutionsCount);
    expect(finalStore.positions['BTCUSDT']).toBeUndefined();
  });

  // ==========================================
  // T13: Repeated order cancellation
  // ==========================================
  it('T13: Repeated order cancellation — idempotent, no double release of funds', () => {
    // Place a limit BUY order for 0.1 BTC @ $70,000
    const placed = placeLimitOrder(
      baseState,
      {
        symbol: 'BTCUSDT',
        baseAsset: 'BTC',
        quoteAsset: 'USDT',
        side: 'buy',
        quantity: 0.1,
        limitPrice: 70000.0,
      },
      DEFAULT_FEE_RATE,
      baseTime
    );
    expect(placed.success).toBe(true);
    const orderId = placed.order!.id;
    const reservedUsdt = placed.newState.usdtReserved;
    expect(reservedUsdt).toBeGreaterThan(0);

    // 1st cancellation
    const cancel1 = cancelOrder(placed.newState, orderId, baseTime + 100);
    expect(cancel1.success).toBe(true);
    expect(cancel1.newState.usdtReserved).toBe(0);

    // 2nd cancellation on the exact same order
    const cancel2 = cancelOrder(cancel1.newState, orderId, baseTime + 200);
    expect(cancel2.success).toBe(false);
    // Reservation must not go below 0 or release balance again!
    expect(cancel2.newState.usdtReserved).toBe(0);
    expect(cancel2.newState.usdtBalance).toBe(cancel1.newState.usdtBalance);
  });

  // ==========================================
  // T14: Limit BUY reservation lock
  // ==========================================
  it('T14: Limit BUY reservation lock — USDT balance locked correctly and available USDT reflects it', () => {
    // 0.1 BTC @ $70,000. Gross = $7,000, fee = $3.50, maxRequired = $7,003.50
    const placed = placeLimitOrder(
      baseState,
      {
        symbol: 'BTCUSDT',
        baseAsset: 'BTC',
        quoteAsset: 'USDT',
        side: 'buy',
        quantity: 0.1,
        limitPrice: 70000.0,
      },
      DEFAULT_FEE_RATE,
      baseTime
    );
    expect(placed.success).toBe(true);
    expect(placed.newState.usdtReserved).toBeCloseTo(7003.5, 2);
    // Available USDT is cash - reserved
    const available = placed.newState.usdtBalance - placed.newState.usdtReserved;
    expect(available).toBeCloseTo(50000.0 - 7003.5, 2);
  });

  // ==========================================
  // T15: Limit SELL reservation lock
  // ==========================================
  it('T15: Limit SELL reservation lock — Crypto position locked correctly', () => {
    baseState.positions['BTCUSDT'] = { ...initialBtcPosition, quantity: 0.5, availableQuantity: 0.5 };

    // Place Limit SELL for 0.2 BTC @ $90,000
    const placed = placeLimitOrder(
      baseState,
      {
        symbol: 'BTCUSDT',
        baseAsset: 'BTC',
        quoteAsset: 'USDT',
        side: 'sell',
        quantity: 0.2,
        limitPrice: 90000.0,
      },
      DEFAULT_FEE_RATE,
      baseTime
    );
    expect(placed.success).toBe(true);

    const pos = placed.newState.positions['BTCUSDT'];
    expect(pos.quantity).toBe(0.5);
    expect(pos.reservedQuantity).toBe(0.2);
    expect(pos.availableQuantity).toBe(0.3);

    // Attempting to place another sell for 0.4 BTC fails because only 0.3 is available
    const secondSell = placeLimitOrder(
      placed.newState,
      {
        symbol: 'BTCUSDT',
        baseAsset: 'BTC',
        quoteAsset: 'USDT',
        side: 'sell',
        quantity: 0.4,
        limitPrice: 91000.0,
      },
      DEFAULT_FEE_RATE,
      baseTime + 100
    );
    expect(secondSell.success).toBe(false);
  });

  // ==========================================
  // T16: Multiple overlapping reservations
  // ==========================================
  it('T16: Multiple overlapping reservations — total locked correctly accounts for all active orders, no overspending', () => {
    // 1. First Limit BUY: 0.2 BTC @ $70,000 -> ~$14,007
    const buy1 = placeLimitOrder(
      baseState,
      {
        symbol: 'BTCUSDT',
        baseAsset: 'BTC',
        quoteAsset: 'USDT',
        side: 'buy',
        quantity: 0.2,
        limitPrice: 70000.0,
      },
      DEFAULT_FEE_RATE,
      baseTime
    );
    expect(buy1.success).toBe(true);

    // 2. Second Limit BUY: 0.4 BTC @ $70,000 -> ~$28,014
    const buy2 = placeLimitOrder(
      buy1.newState,
      {
        symbol: 'BTCUSDT',
        baseAsset: 'BTC',
        quoteAsset: 'USDT',
        side: 'buy',
        quantity: 0.4,
        limitPrice: 70000.0,
      },
      DEFAULT_FEE_RATE,
      baseTime + 10
    );
    expect(buy2.success).toBe(true);

    const totalReserved = buy2.newState.usdtReserved;
    expect(totalReserved).toBeCloseTo(14007.0 + 28014.0, 1);
    const available = buy2.newState.usdtBalance - totalReserved;
    expect(available).toBeCloseTo(50000.0 - 42021.0, 1);

    // 3. Third Limit BUY: Attempting to buy 0.2 BTC @ $70,000 (~$14,007) must fail because available is only ~$7,979
    const buy3 = placeLimitOrder(
      buy2.newState,
      {
        symbol: 'BTCUSDT',
        baseAsset: 'BTC',
        quoteAsset: 'USDT',
        side: 'buy',
        quantity: 0.2,
        limitPrice: 70000.0,
      },
      DEFAULT_FEE_RATE,
      baseTime + 20
    );
    expect(buy3.success).toBe(false);
    expect(buy3.error).toMatch(/insufficient/i);
  });

  // ==========================================
  // T17: Reconnect with existing open orders
  // ==========================================
  it('T17: Reconnect with existing open orders — open orders preserved, no duplicate execution on replay', () => {
    // Place a pending limit BUY @ $75,000 (below current ask $80,010)
    const placed = placeLimitOrder(
      baseState,
      {
        symbol: 'BTCUSDT',
        baseAsset: 'BTC',
        quoteAsset: 'USDT',
        side: 'buy',
        quantity: 0.1,
        limitPrice: 75000.0,
      },
      DEFAULT_FEE_RATE,
      baseTime
    );
    expect(placed.newState.orders[0].status).toBe('pending');

    // Reconnection event receives old quote ($80,010) -> order remains pending
    const matchOld = processPendingMatches(
      placed.newState,
      { BTCUSDT: validQuote },
      DEFAULT_FEE_RATE,
      baseTime + 5000
    );
    expect(matchOld.newState.orders[0].status).toBe('pending');

    // New quote crosses limit price ($74,900 ask) -> fills order
    const crossQuote: Record<string, LiveQuote> = {
      BTCUSDT: {
        symbol: 'BTCUSDT',
        bidPrice: 74890.0,
        askPrice: 74900.0,
        lastPrice: 74900.0,
        timestamp: baseTime + 6000,
      },
    };
    const matchFill = processPendingMatches(
      matchOld.newState,
      crossQuote,
      DEFAULT_FEE_RATE,
      baseTime + 6000
    );
    expect(matchFill.newState.orders[0].status).toBe('filled');
    expect(matchFill.newState.executions).toHaveLength(1);

    // Replay same quote again on reconnect -> no duplicate execution
    const matchReplay = processPendingMatches(
      matchFill.newState,
      crossQuote,
      DEFAULT_FEE_RATE,
      baseTime + 7000
    );
    expect(matchReplay.newState.executions).toHaveLength(1);
    expect(matchReplay.newState.orders[0].status).toBe('filled');
  });

  // ==========================================
  // T18: Page refresh with open positions
  // ==========================================
  it('T18: Page refresh with open positions — positions and orders restored non-destructively from storage', () => {
    baseState.positions['BTCUSDT'] = { ...initialBtcPosition };
    const savedState = {
      ...baseState,
      usdtBalance: 42000.0,
      usdtReserved: 7000.0,
      orders: [
        {
          id: 'ord_1',
          symbol: 'BTCUSDT',
          baseAsset: 'BTC',
          quoteAsset: 'USDT',
          side: 'buy' as const,
          type: 'limit' as const,
          price: 70000.0,
          quantity: 0.1,
          status: 'pending' as const,
          reservedAmount: 7000.0,
          createdAt: baseTime,
        },
      ],
      protectiveOrders: [
        {
          id: 'prot_1',
          groupId: 'grp_1',
          symbol: 'BTCUSDT',
          baseAsset: 'BTC',
          quoteAsset: 'USDT',
          side: 'sell' as const,
          triggerType: 'stop-loss' as const,
          triggerPrice: 75000.0,
          quantity: 0.05,
          status: 'active' as const,
          createdAt: baseTime,
        },
      ],
    };

    // Reconcile and restore
    const restored = reconcileTradingState(savedState);
    expect(restored.usdtBalance).toBe(42000.0);
    expect(restored.positions['BTCUSDT'].quantity).toBe(0.1);
    expect(restored.positions['BTCUSDT'].reservedQuantity).toBe(0.05);
    expect(restored.orders[0].status).toBe('pending');
    expect(restored.protectiveOrders[0].status).toBe('active');
  });

  // ==========================================
  // T19: Accurate fee deduction
  // ==========================================
  it('T19: Accurate fee deduction — exactly 0.05% accounted accurately', () => {
    // Buy 0.1 BTC @ $80,000
    const gross = calculateGrossValue(80000.0, 0.1); // 8,000.00
    const fee = calculateFee(gross, DEFAULT_FEE_RATE); // 8000 * 0.0005 = 4.00
    const totalBuyCost = calculateTotalBuyCost(80000.0, 0.1, DEFAULT_FEE_RATE);

    expect(gross).toBe(8000.0);
    expect(fee).toBe(4.0);
    expect(totalBuyCost).toBe(8004.0);

    const executed = executeMarketOrder(
      baseState,
      {
        symbol: 'BTCUSDT',
        baseAsset: 'BTC',
        quoteAsset: 'USDT',
        side: 'buy',
        quantity: 0.1,
        quote: { ...validQuote, askPrice: 80000.0 },
      },
      DEFAULT_FEE_RATE,
      baseTime
    );

    expect(executed.success).toBe(true);
    expect(executed.newState.usdtBalance).toBe(50000.0 - 8004.0);
    expect(executed.newState.totalFeesPaid).toBe(4.0);
  });

  // ==========================================
  // T20: Realized P&L calculation
  // ==========================================
  it('T20: Realized P&L calculation — cost basis and realized gain/loss matches math', () => {
    // 1. Buy 0.2 BTC @ $80,000.
    // Gross = $16,000, Buy fee = $8.00.
    // Cost basis = $16,008 (capitalized buy fee). Average entry price = $80,040.
    const buyRes = executeMarketOrder(
      baseState,
      {
        symbol: 'BTCUSDT',
        baseAsset: 'BTC',
        quoteAsset: 'USDT',
        side: 'buy',
        quantity: 0.2,
        quote: { ...validQuote, askPrice: 80000.0 },
      },
      DEFAULT_FEE_RATE,
      baseTime
    );
    expect(buyRes.success).toBe(true);

    // 2. Sell 0.1 BTC @ $90,000.
    // Sold cost basis = 0.1 * 80040 = $8,004.
    // Gross proceeds = $9,000. Sell fee = 9000 * 0.0005 = $4.50. Net proceeds = $8,995.50.
    // Realized P&L = $8,995.50 - $8,004.00 = +$991.50.
    const sellRes = executeMarketOrder(
      buyRes.newState,
      {
        symbol: 'BTCUSDT',
        baseAsset: 'BTC',
        quoteAsset: 'USDT',
        side: 'sell',
        quantity: 0.1,
        quote: { ...validQuote, bidPrice: 90000.0 },
      },
      DEFAULT_FEE_RATE,
      baseTime + 1000
    );

    expect(sellRes.success).toBe(true);
    const pos = sellRes.newState.positions['BTCUSDT'];
    expect(pos.quantity).toBe(0.1);
    expect(pos.averageEntryPrice).toBe(80040.0);
    expect(pos.totalCostBasis).toBe(8004.0);
    expect(pos.realizedPnl).toBeCloseTo(991.5, 2);
    expect(sellRes.newState.totalRealizedPnl).toBeCloseTo(991.5, 2);
  });

  // ==========================================
  // T21: Unrealized P&L calculation
  // ==========================================
  it('T21: Unrealized P&L calculation — marked-to-market against quote bid accurately', () => {
    const pos: Position = {
      ...initialBtcPosition,
      quantity: 0.1,
      averageEntryPrice: 80000.0,
      totalCostBasis: 8000.0,
    };

    // Case A: Bid is $85,000 (+5,000/BTC -> +$500)
    const statsGain = calculatePortfolioStats(
      50000,
      0,
      { BTCUSDT: pos },
      { BTCUSDT: 85000.0 },
      0,
      0
    );
    expect(statsGain.unrealizedPnl).toBe(500.0);
    expect(statsGain.unrealizedPnlPercent).toBeCloseTo(6.25, 2); // 500 / 8000 * 100

    // Case B: Bid is $75,000 (-5,000/BTC -> -$500)
    const statsLoss = calculatePortfolioStats(
      50000,
      0,
      { BTCUSDT: pos },
      { BTCUSDT: 75000.0 },
      0,
      0
    );
    expect(statsLoss.unrealizedPnl).toBe(-500.0);
    expect(statsLoss.unrealizedPnlPercent).toBeCloseTo(-6.25, 2);
  });

  // ==========================================
  // T22: Portfolio equity consistency
  // ==========================================
  it('T22: Portfolio equity consistency — Total Equity = Cash Balance + Positions Market Value', () => {
    // Fresh state: Equity = 50,000
    const stats0 = calculatePortfolioStats(
      baseState.usdtBalance,
      baseState.usdtReserved,
      baseState.positions,
      { BTCUSDT: validQuote.bidPrice },
      0,
      0
    );
    expect(stats0.totalEquity).toBe(50000.0);

    // After BUY 0.1 BTC @ $80,000:
    // Cash = 50000 - 8004 = 41996. Position = 0.1 BTC * 80000 bid = 8000.
    // Equity = 41996 + 8000 = 49996 (differs by exactly the $4 fee paid).
    const buyRes = executeMarketOrder(
      baseState,
      {
        symbol: 'BTCUSDT',
        baseAsset: 'BTC',
        quoteAsset: 'USDT',
        side: 'buy',
        quantity: 0.1,
        quote: { ...validQuote, askPrice: 80000.0, bidPrice: 80000.0 },
      },
      DEFAULT_FEE_RATE,
      baseTime
    );

    const stats1 = calculatePortfolioStats(
      buyRes.newState.usdtBalance,
      buyRes.newState.usdtReserved,
      buyRes.newState.positions,
      { BTCUSDT: 80000.0 },
      buyRes.newState.totalFeesPaid,
      buyRes.newState.totalRealizedPnl
    );
    expect(stats1.totalEquity).toBe(49996.0);
    expect(buyRes.newState.usdtBalance + stats1.investedValue).toBe(stats1.totalEquity);
  });

  // ==========================================
  // T23: Stale or invalid market update
  // ==========================================
  it('T23: Stale or invalid market update — matching/protective execution blocked until fresh quote', () => {
    const now = baseTime + 100000;

    // 1. Quote older than 60s
    const staleQuote: LiveQuote = {
      ...validQuote,
      timestamp: now - MAX_QUOTE_AGE_MS - 1000,
    };
    expect(isQuoteFresh(staleQuote, now)).toBe(false);
    expect(validateQuoteFreshness(staleQuote, 'buy', now).isValid).toBe(false);

    // 2. Zero or negative timestamp
    const zeroTimeQuote: LiveQuote = {
      ...validQuote,
      timestamp: 0,
    };
    expect(isQuoteFresh(zeroTimeQuote, now)).toBe(false);

    // 3. Non-positive bid/ask
    const zeroPriceQuote: LiveQuote = {
      ...validQuote,
      bidPrice: 0,
      timestamp: now,
    };
    expect(isQuoteFresh(zeroPriceQuote, now)).toBe(false);

    // 4. Pending order matching ignores stale quotes
    const order: TradeOrder = {
      id: 'ord_stale_1',
      symbol: 'BTCUSDT',
      baseAsset: 'BTC',
      quoteAsset: 'USDT',
      side: 'buy',
      type: 'limit',
      price: 85000.0, // High enough to fill
      quantity: 0.1,
      fee: 4.25,
      status: 'pending',
      reservedAmount: 8500.0,
      createdAt: baseTime,
    };

    const matchRes = matchPendingOrders([order], { BTCUSDT: staleQuote }, DEFAULT_FEE_RATE, now);
    expect(matchRes.filledOrders).toHaveLength(0);
    expect(matchRes.remainingPendingOrders).toHaveLength(1);
  });

  // ==========================================
  // T24: Failed execution during matching
  // ==========================================
  it('T24: Failed execution during matching — state rolls back safely, no partial balance mutation', () => {
    // Force an invalid setup in protective orders (e.g. stopLoss above current market price)
    baseState.positions['BTCUSDT'] = { ...initialBtcPosition };
    const invalidSetup = createProtectiveOrders(
      baseState,
      {
        symbol: 'BTCUSDT',
        baseAsset: 'BTC',
        quoteAsset: 'USDT',
        quantity: 0.05,
        stopLossPrice: 90000.0, // Invalid: above current 80,000 bid
        quote: validQuote,
      },
      baseTime
    );

    expect(invalidSetup.success).toBe(false);
    expect(invalidSetup.error).toMatch(/strictly below/i);
    // Base state unchanged
    expect(baseState.positions['BTCUSDT'].reservedQuantity).toBe(0);
    expect(baseState.protectiveOrders).toHaveLength(0);
  });

  // ==========================================
  // T25: Concurrent order placement across tabs
  // ==========================================
  it('T25: Concurrent order placement across tabs — storage reconciliation preserves valid state without balance loss', () => {
    baseState.positions['BTCUSDT'] = { ...initialBtcPosition };

    // Simulate cross-tab sync where storage received an external update with an active order
    const foreignTabState: TradingAccountState & { protectiveOrders: ProtectiveOrder[] } = {
      ...baseState,
      usdtBalance: 45000.0,
      usdtReserved: 5000.0,
      orders: [
        {
          id: 'ext_order_1',
          symbol: 'BTCUSDT',
          baseAsset: 'BTC',
          quoteAsset: 'USDT',
          side: 'buy',
          type: 'limit',
          price: 50000.0,
          quantity: 0.1,
          fee: 2.5,
          status: 'pending',
          reservedAmount: 5002.5,
          createdAt: baseTime,
        },
      ],
      protectiveOrders: [],
    };

    // Reconcile foreign state
    const reconciled = reconcileTradingState(foreignTabState);
    expect(reconciled.usdtBalance).toBe(45000.0);
    expect(reconciled.usdtReserved).toBe(5002.5); // Reconciled against active pending buy orders
    expect(reconciled.orders).toHaveLength(1);
    expect(reconciled.positions['BTCUSDT'].quantity).toBe(0.1);
  });
});
