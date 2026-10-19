import Decimal from 'decimal.js';
import {
  TradeOrder,
  TradeExecution,
  Position,
  OrderSide,
  LiveQuote,
  ProtectiveOrder,
} from '../types';
import {
  calculateGrossValue,
  calculateFee,
  DEFAULT_FEE_RATE,
} from './feeCalculator';
import {
  validateMarketOrder,
  validateLimitOrder,
} from './orderValidator';
import {
  applyBuyToPosition,
  applySellToPosition,
  INITIAL_CAPITAL,
} from './portfolioAccounting';
import { matchPendingOrders } from './orderMatcher';
import { canTransitionOrderStatus } from './orderLifecycle';

export {
  validateProtectiveOrderSetup,
  createProtectiveOrders,
  cancelProtectiveOrder,
  cancelProtectiveLeg,
  cancelProtectiveGroup,
  evaluateProtectiveTriggers,
} from './protectiveOrderEngine';
export * from './orderLifecycle';

export interface TradingAccountState {
  usdtBalance: number;
  usdtReserved: number;
  positions: Record<string, Position>;
  orders: TradeOrder[];
  executions: TradeExecution[];
  protectiveOrders: ProtectiveOrder[];
  totalRealizedPnl: number;
  totalFeesPaid: number;
}

export function createInitialTradingState(): TradingAccountState {
  return {
    usdtBalance: INITIAL_CAPITAL,
    usdtReserved: 0,
    positions: {},
    orders: [],
    executions: [],
    protectiveOrders: [],
    totalRealizedPnl: 0,
    totalFeesPaid: 0,
  };
}

/**
 * Executes a simulated Market Order immediately against the provided live quote.
 */
export function executeMarketOrder(
  state: TradingAccountState,
  params: {
    symbol: string;
    baseAsset: string;
    quoteAsset: string;
    side: OrderSide;
    quantity: number;
    quote: LiveQuote;
  },
  feeRate: number = DEFAULT_FEE_RATE,
  now: number = Date.now()
): {
  success: boolean;
  newState: TradingAccountState;
  execution?: TradeExecution;
  order?: TradeOrder;
  error?: string;
} {
  const currentPos = state.positions[params.symbol];
  const availableUsdt = Math.max(0, state.usdtBalance - state.usdtReserved);

  const validation = validateMarketOrder(
    params.side,
    params.quantity,
    params.quote,
    availableUsdt,
    currentPos,
    feeRate,
    now
  );

  if (!validation.isValid || !validation.executablePrice) {
    return {
      success: false,
      newState: state,
      error: validation.error || 'Market order validation failed.',
    };
  }

  const execPrice = validation.executablePrice;
  const grossValue = calculateGrossValue(execPrice, params.quantity);
  const fee = calculateFee(grossValue, feeRate);
  const netValue = params.side === 'buy' ? grossValue + fee : grossValue - fee;

  const orderId = `ord_${now}_${Math.random().toString(36).substring(2, 7)}`;
  const executionId = `exec_${now}_${Math.random().toString(36).substring(2, 7)}`;

  let newUsdtBalance = state.usdtBalance;
  let newRealizedPnl = state.totalRealizedPnl;
  const newPositions = { ...state.positions };

  if (params.side === 'buy') {
    // Total USDT decreases by grossValue + fee
    newUsdtBalance = new Decimal(state.usdtBalance)
      .sub(netValue)
      .toDecimalPlaces(4, Decimal.ROUND_HALF_UP)
      .toNumber();

    const execution: TradeExecution = {
      id: executionId,
      orderId,
      symbol: params.symbol,
      baseAsset: params.baseAsset,
      quoteAsset: params.quoteAsset,
      side: 'buy',
      type: 'market',
      price: execPrice,
      quantity: params.quantity,
      grossValue,
      fee,
      netValue,
      timestamp: now,
    };

    newPositions[params.symbol] = applyBuyToPosition(currentPos, execution);

    const order: TradeOrder = {
      id: orderId,
      symbol: params.symbol,
      baseAsset: params.baseAsset,
      quoteAsset: params.quoteAsset,
      side: 'buy',
      type: 'market',
      price: execPrice,
      quantity: params.quantity,
      filledPrice: execPrice,
      filledQuantity: params.quantity,
      fee,
      status: 'filled',
      reservedAmount: 0,
      createdAt: now,
      filledAt: now,
    };

    const newFeesPaid = new Decimal(state.totalFeesPaid).add(fee).toNumber();

    return {
      success: true,
      newState: {
        ...state,
        usdtBalance: newUsdtBalance,
        positions: newPositions,
        orders: [order, ...state.orders],
        executions: [execution, ...state.executions],
        totalFeesPaid: newFeesPaid,
      },
      execution,
      order,
    };
  } else {
    // Market Sell
    const tempExecution: TradeExecution = {
      id: executionId,
      orderId,
      symbol: params.symbol,
      baseAsset: params.baseAsset,
      quoteAsset: params.quoteAsset,
      side: 'sell',
      type: 'market',
      price: execPrice,
      quantity: params.quantity,
      grossValue,
      fee,
      netValue,
      timestamp: now,
    };

    const { updatedPosition, realizedPnl } = applySellToPosition(currentPos, tempExecution);

    if (updatedPosition) {
      newPositions[params.symbol] = updatedPosition;
    } else {
      delete newPositions[params.symbol];
    }

    // Net proceeds credited to USDT wallet
    newUsdtBalance = new Decimal(state.usdtBalance)
      .add(netValue)
      .toDecimalPlaces(4, Decimal.ROUND_HALF_UP)
      .toNumber();

    newRealizedPnl = new Decimal(state.totalRealizedPnl)
      .add(realizedPnl)
      .toDecimalPlaces(4, Decimal.ROUND_HALF_UP)
      .toNumber();

    const execution: TradeExecution = {
      ...tempExecution,
      realizedPnl,
    };

    const order: TradeOrder = {
      id: orderId,
      symbol: params.symbol,
      baseAsset: params.baseAsset,
      quoteAsset: params.quoteAsset,
      side: 'sell',
      type: 'market',
      price: execPrice,
      quantity: params.quantity,
      filledPrice: execPrice,
      filledQuantity: params.quantity,
      fee,
      status: 'filled',
      reservedAmount: 0,
      createdAt: now,
      filledAt: now,
    };

    const newFeesPaid = new Decimal(state.totalFeesPaid).add(fee).toNumber();

    return {
      success: true,
      newState: {
        ...state,
        usdtBalance: newUsdtBalance,
        positions: newPositions,
        orders: [order, ...state.orders],
        executions: [execution, ...state.executions],
        totalRealizedPnl: newRealizedPnl,
        totalFeesPaid: newFeesPaid,
      },
      execution,
      order,
    };
  }
}

/**
 * Places a simulated Limit Order into pending state with balance/holding reservation.
 */
export function placeLimitOrder(
  state: TradingAccountState,
  params: {
    symbol: string;
    baseAsset: string;
    quoteAsset: string;
    side: OrderSide;
    quantity: number;
    limitPrice: number;
  },
  feeRate: number = DEFAULT_FEE_RATE,
  now: number = Date.now()
): {
  success: boolean;
  newState: TradingAccountState;
  order?: TradeOrder;
  error?: string;
} {
  const currentPos = state.positions[params.symbol];
  const availableUsdt = Math.max(0, state.usdtBalance - state.usdtReserved);

  const validation = validateLimitOrder(
    params.side,
    params.quantity,
    params.limitPrice,
    availableUsdt,
    currentPos,
    feeRate
  );

  if (!validation.isValid || validation.reservedAmount === undefined) {
    return {
      success: false,
      newState: state,
      error: validation.error || 'Limit order validation failed.',
    };
  }

  const orderId = `ord_${now}_${Math.random().toString(36).substring(2, 7)}`;
  const order: TradeOrder = {
    id: orderId,
    symbol: params.symbol,
    baseAsset: params.baseAsset,
    quoteAsset: params.quoteAsset,
    side: params.side,
    type: 'limit',
    price: params.limitPrice,
    quantity: params.quantity,
    fee: calculateFee(calculateGrossValue(params.limitPrice, params.quantity), feeRate),
    status: 'pending',
    reservedAmount: validation.reservedAmount,
    createdAt: now,
  };

  let newUsdtReserved = state.usdtReserved;
  const newPositions = { ...state.positions };

  if (params.side === 'buy') {
    newUsdtReserved = new Decimal(state.usdtReserved)
      .add(validation.reservedAmount)
      .toDecimalPlaces(4, Decimal.ROUND_HALF_UP)
      .toNumber();
  } else {
    // Lock asset quantity in position
    if (currentPos) {
      const newReservedQty = new Decimal(currentPos.reservedQuantity)
        .add(params.quantity)
        .toDecimalPlaces(8, Decimal.ROUND_HALF_UP)
        .toNumber();
      const newAvailQty = Math.max(0, currentPos.quantity - newReservedQty);

      newPositions[params.symbol] = {
        ...currentPos,
        reservedQuantity: newReservedQty,
        availableQuantity: newAvailQty,
        updatedAt: now,
      };
    }
  }

  return {
    success: true,
    newState: {
      ...state,
      usdtReserved: newUsdtReserved,
      positions: newPositions,
      orders: [order, ...state.orders],
    },
    order,
  };
}

/**
 * Cancels a pending limit order and releases reserved USDT or asset holdings.
 */
export function cancelOrder(
  state: TradingAccountState,
  orderId: string,
  now: number = Date.now()
): {
  success: boolean;
  newState: TradingAccountState;
  canceledOrder?: TradeOrder;
  error?: string;
} {
  const orderIndex = state.orders.findIndex((o) => o.id === orderId);
  if (orderIndex === -1) {
    return { success: false, newState: state, error: 'Order not found.' };
  }

  const order = state.orders[orderIndex];
  if (order.status !== 'pending' || !canTransitionOrderStatus(order.status, 'canceled')) {
    return { success: false, newState: state, error: `Order is not pending (status: ${order.status}).` };
  }

  let newUsdtReserved = state.usdtReserved;
  const newPositions = { ...state.positions };

  if (order.side === 'buy') {
    newUsdtReserved = Decimal.max(
      0,
      new Decimal(state.usdtReserved).sub(order.reservedAmount)
    ).toDecimalPlaces(4, Decimal.ROUND_HALF_UP).toNumber();
  } else {
    const pos = state.positions[order.symbol];
    if (pos) {
      const newReservedQty = Decimal.max(
        0,
        new Decimal(pos.reservedQuantity).sub(order.reservedAmount)
      ).toDecimalPlaces(8, Decimal.ROUND_HALF_UP).toNumber();
      const newAvailQty = Math.max(0, pos.quantity - newReservedQty);

      newPositions[order.symbol] = {
        ...pos,
        reservedQuantity: newReservedQty,
        availableQuantity: newAvailQty,
        updatedAt: now,
      };
    }
  }

  const updatedOrder: TradeOrder = {
    ...order,
    status: 'canceled',
    rejectionReason: 'Canceled by user',
  };

  const newOrders = [...state.orders];
  newOrders[orderIndex] = updatedOrder;

  return {
    success: true,
    newState: {
      ...state,
      usdtReserved: newUsdtReserved,
      positions: newPositions,
      orders: newOrders,
    },
    canceledOrder: updatedOrder,
  };
}

/**
 * Evaluates pending orders against fresh quotes and fills eligible ones atomically.
 */
export function processPendingMatches(
  state: TradingAccountState,
  quotes: Record<string, LiveQuote>,
  feeRate: number = DEFAULT_FEE_RATE,
  now: number = Date.now()
): {
  newState: TradingAccountState;
  filledOrders: TradeOrder[];
  executions: TradeExecution[];
} {
  const pendingOrders = state.orders.filter((o) => o.status === 'pending');
  if (pendingOrders.length === 0) {
    return { newState: state, filledOrders: [], executions: [] };
  }

  const { filledOrders, executions } = matchPendingOrders(
    pendingOrders,
    quotes,
    feeRate,
    now
  );

  if (filledOrders.length === 0) {
    return { newState: state, filledOrders: [], executions: [] };
  }

  let newUsdtBalance = new Decimal(state.usdtBalance);
  let newUsdtReserved = new Decimal(state.usdtReserved);
  let newRealizedPnl = new Decimal(state.totalRealizedPnl);
  let newFeesPaid = new Decimal(state.totalFeesPaid);
  const newPositions = { ...state.positions };

  // Map for fast order update
  const filledMap = new Map<string, TradeOrder>();
  filledOrders.forEach((o) => filledMap.set(o.id, o));

  const stateOrderMap = new Map<string, TradeOrder>();
  state.orders.forEach((o) => stateOrderMap.set(o.id, o));

  for (const exec of executions) {
    const origOrder = stateOrderMap.get(exec.orderId);
    if (!origOrder || !canTransitionOrderStatus(origOrder.status, 'filled')) continue;

    newFeesPaid = newFeesPaid.add(exec.fee);

    if (exec.side === 'buy') {
      // Release buy reservation and deduct actual executed total cost
      newUsdtReserved = Decimal.max(0, newUsdtReserved.sub(origOrder.reservedAmount));
      newUsdtBalance = newUsdtBalance.sub(exec.netValue);

      newPositions[exec.symbol] = applyBuyToPosition(newPositions[exec.symbol], exec);
    } else {
      // Limit sell filled
      const pos = newPositions[exec.symbol];
      if (pos) {
        // First release holding reservation
        const reservedAfterRelease = Decimal.max(0, new Decimal(pos.reservedQuantity).sub(origOrder.reservedAmount)).toNumber();
        const tempPos = {
          ...pos,
          reservedQuantity: reservedAfterRelease,
          availableQuantity: Math.max(0, pos.quantity - reservedAfterRelease),
        };

        const { updatedPosition, realizedPnl } = applySellToPosition(tempPos, exec);
        exec.realizedPnl = realizedPnl;
        newRealizedPnl = newRealizedPnl.add(realizedPnl);

        if (updatedPosition) {
          newPositions[exec.symbol] = updatedPosition;
        } else {
          delete newPositions[exec.symbol];
        }

        newUsdtBalance = newUsdtBalance.add(exec.netValue);
      }
    }
  }

  const newOrders = state.orders.map((o) => filledMap.get(o.id) || o);

  return {
    newState: {
      ...state,
      usdtBalance: newUsdtBalance.toDecimalPlaces(4, Decimal.ROUND_HALF_UP).toNumber(),
      usdtReserved: newUsdtReserved.toDecimalPlaces(4, Decimal.ROUND_HALF_UP).toNumber(),
      positions: newPositions,
      orders: newOrders,
      executions: [...executions, ...state.executions],
      totalRealizedPnl: newRealizedPnl.toDecimalPlaces(4, Decimal.ROUND_HALF_UP).toNumber(),
      totalFeesPaid: newFeesPaid.toDecimalPlaces(4, Decimal.ROUND_HALF_UP).toNumber(),
    },
    filledOrders,
    executions,
  };
}
