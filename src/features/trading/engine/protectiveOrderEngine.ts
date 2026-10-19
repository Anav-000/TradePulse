import Decimal from 'decimal.js';
import {
  ProtectiveOrder,
  TradeOrder,
  TradeExecution,
  Position,
  LiveQuote,
} from '../types';
import { TradingAccountState } from './orderEngine';
import {
  calculateGrossValue,
  calculateFee,
  DEFAULT_FEE_RATE,
} from './feeCalculator';
import {
  validateOrderBasics,
  validateQuoteFreshness,
  isQuoteFresh,
  MIN_ORDER_NOTIONAL_USDT,
} from './orderValidator';
import { canTransitionProtectiveStatus } from './orderLifecycle';
import { applySellToPosition } from './portfolioAccounting';

export interface ProtectiveValidationResult {
  isValid: boolean;
  error?: string;
  executableBid?: number;
}

/**
 * Validates a Stop-Loss and/or Take-Profit configuration against current position and live quotes.
 */
export function validateProtectiveOrderSetup(
  quantity: number,
  stopLossPrice?: number,
  takeProfitPrice?: number,
  position?: Position | null,
  quote?: LiveQuote | null,
  now: number = Date.now()
): ProtectiveValidationResult {
  // 1. Basics
  const basics = validateOrderBasics(quantity);
  if (!basics.isValid) {
    return { isValid: false, error: basics.error };
  }

  // 2. Position existence and available holdings
  if (!position || position.quantity <= 0) {
    return {
      isValid: false,
      error: 'No active position held in this cryptocurrency to protect.',
    };
  }

  if (quantity > position.availableQuantity) {
    return {
      isValid: false,
      error: `Requested protection quantity (${quantity}) exceeds uncommitted holdings (${position.availableQuantity.toFixed(4)}).`,
    };
  }

  // 3. Must specify at least one trigger
  if (stopLossPrice === undefined && takeProfitPrice === undefined) {
    return {
      isValid: false,
      error: 'Please specify at least a Stop-Loss or a Take-Profit trigger price.',
    };
  }

  // 4. Quote validation (must have valid executable bid)
  const quoteValidation = validateQuoteFreshness(quote, 'sell', now);
  if (!quoteValidation.isValid || !quoteValidation.executablePrice) {
    return {
      isValid: false,
      error: quoteValidation.error || 'Live market quote is unavailable or stale.',
    };
  }

  const currentBid = quoteValidation.executablePrice;

  // 5. Minimum notional check
  const notional = currentBid * quantity;
  if (notional < MIN_ORDER_NOTIONAL_USDT) {
    return {
      isValid: false,
      error: `Protection notional value ($${notional.toFixed(4)}) is below the minimum required $${MIN_ORDER_NOTIONAL_USDT.toFixed(2)} USDT.`,
    };
  }

  // 6. Stop-Loss price validation (must be strictly below current executable bid)
  if (stopLossPrice !== undefined) {
    const slBasics = validateOrderBasics(quantity, stopLossPrice);
    if (!slBasics.isValid) {
      return { isValid: false, error: slBasics.error };
    }
    if (stopLossPrice >= currentBid) {
      return {
        isValid: false,
        error: `Stop-loss trigger price ($${stopLossPrice.toLocaleString(undefined, { minimumFractionDigits: 2 })}) must be strictly below current market bid ($${currentBid.toLocaleString(undefined, { minimumFractionDigits: 2 })}).`,
      };
    }
  }

  // 7. Take-Profit price validation (must be strictly above current executable bid)
  if (takeProfitPrice !== undefined) {
    const tpBasics = validateOrderBasics(quantity, takeProfitPrice);
    if (!tpBasics.isValid) {
      return { isValid: false, error: tpBasics.error };
    }
    if (takeProfitPrice <= currentBid) {
      return {
        isValid: false,
        error: `Take-profit trigger price ($${takeProfitPrice.toLocaleString(undefined, { minimumFractionDigits: 2 })}) must be strictly above current market bid ($${currentBid.toLocaleString(undefined, { minimumFractionDigits: 2 })}).`,
      };
    }
  }

  // 7. If both specified, ensure stopLoss < takeProfit
  if (
    stopLossPrice !== undefined &&
    takeProfitPrice !== undefined &&
    stopLossPrice >= takeProfitPrice
  ) {
    return {
      isValid: false,
      error: 'Stop-loss trigger price must be lower than take-profit trigger price.',
    };
  }

  return { isValid: true, executableBid: currentBid };
}

/**
 * Creates a standalone or OCO-linked protective order set, reserving holdings exactly once.
 */
export function createProtectiveOrders(
  state: TradingAccountState & { protectiveOrders: ProtectiveOrder[] },
  params: {
    symbol: string;
    baseAsset: string;
    quoteAsset: string;
    quantity: number;
    stopLossPrice?: number;
    takeProfitPrice?: number;
    quote?: LiveQuote | null;
  },
  now: number = Date.now()
): {
  success: boolean;
  newState: TradingAccountState & { protectiveOrders: ProtectiveOrder[] };
  createdOrders?: ProtectiveOrder[];
  groupId?: string;
  error?: string;
} {
  const currentPos = state.positions[params.symbol];
  const validation = validateProtectiveOrderSetup(
    params.quantity,
    params.stopLossPrice,
    params.takeProfitPrice,
    currentPos,
    params.quote,
    now
  );

  if (!validation.isValid) {
    return {
      success: false,
      newState: state,
      error: validation.error,
    };
  }

  const groupId = `prot_grp_${now}_${Math.random().toString(36).substring(2, 7)}`;
  const createdOrders: ProtectiveOrder[] = [];

  // Stop-Loss
  if (params.stopLossPrice !== undefined) {
    const slOrder: ProtectiveOrder = {
      id: `prot_sl_${now}_${Math.random().toString(36).substring(2, 7)}`,
      symbol: params.symbol,
      baseAsset: params.baseAsset,
      quoteAsset: params.quoteAsset,
      side: 'sell',
      triggerType: 'stop-loss',
      triggerPrice: params.stopLossPrice,
      quantity: params.quantity,
      status: 'active',
      groupId,
      createdAt: now,
    };
    createdOrders.push(slOrder);
  }

  // Take-Profit
  if (params.takeProfitPrice !== undefined) {
    const tpOrder: ProtectiveOrder = {
      id: `prot_tp_${now}_${Math.random().toString(36).substring(2, 7)}`,
      symbol: params.symbol,
      baseAsset: params.baseAsset,
      quoteAsset: params.quoteAsset,
      side: 'sell',
      triggerType: 'take-profit',
      triggerPrice: params.takeProfitPrice,
      quantity: params.quantity,
      status: 'active',
      groupId,
      createdAt: now,
    };
    createdOrders.push(tpOrder);
  }

  // Atomically lock holdings exactly once for this group
  const newPositions = { ...state.positions };
  if (currentPos) {
    const newReserved = new Decimal(currentPos.reservedQuantity)
      .add(params.quantity)
      .toDecimalPlaces(8, Decimal.ROUND_HALF_UP)
      .toNumber();
    const newAvailable = Math.max(0, currentPos.quantity - newReserved);

    newPositions[params.symbol] = {
      ...currentPos,
      reservedQuantity: newReserved,
      availableQuantity: newAvailable,
      updatedAt: now,
    };
  }

  return {
    success: true,
    newState: {
      ...state,
      positions: newPositions,
      protectiveOrders: [...createdOrders, ...state.protectiveOrders],
    },
    createdOrders,
    groupId,
  };
}

/**
 * Cancels a protective order.
 * In TradePulse, if the order is part of a linked OCO pair:
 * - By default (cancelSibling !== false), canceling either member atomically cancels the entire pair
 *   and releases the shared holdings reservation exactly once.
 * - If cancelSibling === false (e.g. canceling a single leg), only that leg is cancelled;
 *   the sibling remains active and the shared reservation is retained.
 */
export function cancelProtectiveOrder(
  state: TradingAccountState & { protectiveOrders: ProtectiveOrder[] },
  orderId: string,
  now: number = Date.now(),
  options?: { cancelSibling?: boolean }
): {
  success: boolean;
  newState: TradingAccountState & { protectiveOrders: ProtectiveOrder[] };
  canceledOrder?: ProtectiveOrder;
  canceledOrders: ProtectiveOrder[];
  isLinkedOco: boolean;
  releasedQuantity: number;
  error?: string;
} {
  const cancelSibling = options?.cancelSibling !== false;

  const orderIndex = state.protectiveOrders.findIndex((p) => p.id === orderId);
  if (orderIndex === -1) {
    return {
      success: false,
      newState: state,
      canceledOrders: [],
      isLinkedOco: false,
      releasedQuantity: 0,
      error: 'Protective order not found.',
    };
  }

  const order = state.protectiveOrders[orderIndex];
  if (order.status !== 'active' || !canTransitionProtectiveStatus(order.status, 'cancelled')) {
    return {
      success: false,
      newState: state,
      canceledOrders: [],
      isLinkedOco: false,
      releasedQuantity: 0,
      error: `Protective order is not active (current status: ${order.status}).`,
    };
  }

  // Find all orders sharing this groupId
  const groupOrders = state.protectiveOrders.filter((p) => p.groupId === order.groupId);
  const isLinkedOco = groupOrders.length > 1;
  const activeInGroup = groupOrders.filter((p) => p.status === 'active');

  // If part of linked OCO pair and cancelSibling is true, cancel ALL active orders in this group.
  // Otherwise, cancel this single order.
  const ordersToCancel = cancelSibling && isLinkedOco ? activeInGroup : [order];
  const canceledIds = new Set(ordersToCancel.map((o) => o.id));
  const canceledOrders = ordersToCancel.map((o) => ({
    ...o,
    status: 'cancelled' as const,
  }));

  const newProtectiveOrders = state.protectiveOrders.map((p) =>
    canceledIds.has(p.id) ? { ...p, status: 'cancelled' as const } : p
  );

  // Check if any other order in this group is STILL active after this cancellation
  const remainingActiveInGroup = newProtectiveOrders.filter(
    (p) => p.groupId === order.groupId && p.status === 'active'
  );

  const newPositions = { ...state.positions };
  const currentPos = newPositions[order.symbol];
  let releasedQuantity = 0;

  // Release the shared reservation ONLY if no other active order in this group remains!
  // If an active sibling still exists, the reservation must be retained for that leg.
  if (remainingActiveInGroup.length === 0 && currentPos && currentPos.reservedQuantity > 0) {
    releasedQuantity = Math.min(order.quantity, currentPos.reservedQuantity);
    const newReserved = Decimal.max(
      0,
      new Decimal(currentPos.reservedQuantity).sub(order.quantity)
    )
      .toDecimalPlaces(8, Decimal.ROUND_HALF_UP)
      .toNumber();

    const newAvailable = Decimal.max(
      0,
      new Decimal(currentPos.quantity).sub(newReserved)
    )
      .toDecimalPlaces(8, Decimal.ROUND_HALF_UP)
      .toNumber();

    newPositions[order.symbol] = {
      ...currentPos,
      reservedQuantity: newReserved,
      availableQuantity: newAvailable,
      updatedAt: now,
    };
  }

  const primaryCanceled =
    canceledOrders.find((o) => o.id === orderId) || canceledOrders[0];

  return {
    success: true,
    newState: {
      ...state,
      positions: newPositions,
      protectiveOrders: newProtectiveOrders,
    },
    canceledOrder: primaryCanceled,
    canceledOrders,
    isLinkedOco,
    releasedQuantity,
  };
}

/**
 * Cancels a single protective leg without canceling its sibling.
 * The shared reservation is retained as long as the sibling remains active.
 */
export function cancelProtectiveLeg(
  state: TradingAccountState & { protectiveOrders: ProtectiveOrder[] },
  orderId: string,
  now: number = Date.now()
) {
  return cancelProtectiveOrder(state, orderId, now, { cancelSibling: false });
}

/**
 * Cancels all active protective orders in a linked group and releases the reservation once.
 */
export function cancelProtectiveGroup(
  state: TradingAccountState & { protectiveOrders: ProtectiveOrder[] },
  groupId: string,
  now: number = Date.now()
): {
  success: boolean;
  newState: TradingAccountState & { protectiveOrders: ProtectiveOrder[] };
  canceledOrders: ProtectiveOrder[];
  isLinkedOco: boolean;
  releasedQuantity: number;
  error?: string;
} {
  const groupOrders = state.protectiveOrders.filter((p) => p.groupId === groupId);
  const activeInGroup = groupOrders.filter((p) => p.status === 'active');

  if (activeInGroup.length === 0) {
    return {
      success: false,
      newState: state,
      canceledOrders: [],
      isLinkedOco: groupOrders.length > 1,
      releasedQuantity: 0,
      error: 'No active protective orders found in this group.',
    };
  }

  const representative = activeInGroup[0];
  const canceledIds = new Set(activeInGroup.map((o) => o.id));
  const canceledOrders = activeInGroup.map((o) => ({ ...o, status: 'cancelled' as const }));

  const newProtectiveOrders = state.protectiveOrders.map((p) =>
    canceledIds.has(p.id) ? { ...p, status: 'cancelled' as const } : p
  );

  const newPositions = { ...state.positions };
  const currentPos = newPositions[representative.symbol];
  let releasedQuantity = 0;

  if (currentPos && currentPos.reservedQuantity > 0) {
    releasedQuantity = Math.min(representative.quantity, currentPos.reservedQuantity);
    const newReserved = Decimal.max(
      0,
      new Decimal(currentPos.reservedQuantity).sub(representative.quantity)
    )
      .toDecimalPlaces(8, Decimal.ROUND_HALF_UP)
      .toNumber();

    const newAvailable = Decimal.max(
      0,
      new Decimal(currentPos.quantity).sub(newReserved)
    )
      .toDecimalPlaces(8, Decimal.ROUND_HALF_UP)
      .toNumber();

    newPositions[representative.symbol] = {
      ...currentPos,
      reservedQuantity: newReserved,
      availableQuantity: newAvailable,
      updatedAt: now,
    };
  }

  return {
    success: true,
    newState: {
      ...state,
      positions: newPositions,
      protectiveOrders: newProtectiveOrders,
    },
    canceledOrders,
    isLinkedOco: groupOrders.length > 1,
    releasedQuantity,
  };
}

/**
 * Evaluates active Stop-Loss and Take-Profit orders against incoming live quotes,
 * executing triggered orders atomically, canceling linked OCO counterparts,
 * and maintaining exact portfolio accounting.
 */
export function evaluateProtectiveTriggers(
  state: TradingAccountState & { protectiveOrders: ProtectiveOrder[] },
  quotes: Record<string, LiveQuote>,
  feeRate: number = DEFAULT_FEE_RATE,
  now: number = Date.now()
): {
  newState: TradingAccountState & { protectiveOrders: ProtectiveOrder[] };
  triggeredOrders: ProtectiveOrder[];
  canceledOrders: ProtectiveOrder[];
  executions: TradeExecution[];
  orders: TradeOrder[];
} {
  const activeOrders = state.protectiveOrders.filter((p) => p.status === 'active');
  if (activeOrders.length === 0) {
    return {
      newState: state,
      triggeredOrders: [],
      canceledOrders: [],
      executions: [],
      orders: [],
    };
  }

  let newUsdtBalance = new Decimal(state.usdtBalance);
  let newRealizedPnl = new Decimal(state.totalRealizedPnl);
  let newFeesPaid = new Decimal(state.totalFeesPaid);
  const newPositions = { ...state.positions };

  // Work with a mutable copy of protective orders for this matching cycle
  const protectiveMap = new Map<string, ProtectiveOrder>();
  state.protectiveOrders.forEach((p) => protectiveMap.set(p.id, { ...p }));

  const executedOrdersList: ProtectiveOrder[] = [];
  const canceledOrdersList: ProtectiveOrder[] = [];
  const generatedExecutions: TradeExecution[] = [];
  const generatedOrders: TradeOrder[] = [];

  // Track executed group IDs to prevent OCO counterpart from triggering in the same tick
  const handledGroupIds = new Set<string>();

  for (const protOrder of activeOrders) {
    // If another order in this OCO group already executed in this loop, skip
    if (handledGroupIds.has(protOrder.groupId)) {
      continue;
    }

    const currentProt = protectiveMap.get(protOrder.id);
    if (!currentProt || currentProt.status !== 'active' || !canTransitionProtectiveStatus(currentProt.status, 'executed')) {
      continue;
    }

    const quote = quotes[protOrder.symbol];
    if (!isQuoteFresh(quote, now)) {
      continue;
    }

    const currentBid = quote.bidPrice;
    let isTriggered = false;

    if (protOrder.triggerType === 'stop-loss') {
      if (currentBid <= protOrder.triggerPrice) {
        isTriggered = true;
      }
    } else if (protOrder.triggerType === 'take-profit') {
      if (currentBid >= protOrder.triggerPrice) {
        isTriggered = true;
      }
    }

    if (!isTriggered) {
      continue;
    }

    // Trigger condition is met!
    const pos = newPositions[protOrder.symbol];
    if (!pos || pos.quantity < protOrder.quantity) {
      // Position is insufficient or corrupted; set error state on trigger without canceling counterpart
      const failedOrder: ProtectiveOrder = {
        ...currentProt,
        status: 'failed',
        triggeredAt: now,
        error: 'Insufficient position available at execution time.',
      };
      protectiveMap.set(protOrder.id, failedOrder);
      continue;
    }

    // 1. Release the reservation for this group prior to applying sell
    const reservedAfterRelease = Decimal.max(
      0,
      new Decimal(pos.reservedQuantity).sub(protOrder.quantity)
    )
      .toDecimalPlaces(8, Decimal.ROUND_HALF_UP)
      .toNumber();
    const tempPos: Position = {
      ...pos,
      reservedQuantity: reservedAfterRelease,
      availableQuantity: Math.max(0, pos.quantity - reservedAfterRelease),
    };

    // 2. Execute simulated market sell at current executable Bid price
    const execPrice = currentBid;
    const grossValue = calculateGrossValue(execPrice, protOrder.quantity);
    const fee = calculateFee(grossValue, feeRate);
    const netValue = grossValue - fee;

    const orderId = `ord_prot_${now}_${Math.random().toString(36).substring(2, 7)}`;
    const executionId = `exec_prot_${now}_${Math.random().toString(36).substring(2, 7)}`;

    const tempExecution: TradeExecution = {
      id: executionId,
      orderId,
      symbol: protOrder.symbol,
      baseAsset: protOrder.baseAsset,
      quoteAsset: protOrder.quoteAsset,
      side: 'sell',
      type: 'market',
      price: execPrice,
      quantity: protOrder.quantity,
      grossValue,
      fee,
      netValue,
      timestamp: now,
    };

    const { updatedPosition, realizedPnl } = applySellToPosition(tempPos, tempExecution);

    if (updatedPosition) {
      newPositions[protOrder.symbol] = updatedPosition;
    } else {
      delete newPositions[protOrder.symbol];
    }

    // 3. Update accounting
    newUsdtBalance = newUsdtBalance.add(netValue);
    newRealizedPnl = newRealizedPnl.add(realizedPnl);
    newFeesPaid = newFeesPaid.add(fee);

    const execution: TradeExecution = {
      ...tempExecution,
      realizedPnl,
    };

    const tradeOrder: TradeOrder = {
      id: orderId,
      symbol: protOrder.symbol,
      baseAsset: protOrder.baseAsset,
      quoteAsset: protOrder.quoteAsset,
      side: 'sell',
      type: 'market',
      price: execPrice,
      quantity: protOrder.quantity,
      filledPrice: execPrice,
      filledQuantity: protOrder.quantity,
      fee,
      status: 'filled',
      reservedAmount: 0,
      createdAt: now,
      filledAt: now,
      protectiveOrderId: protOrder.id,
      orderLabel: protOrder.triggerType === 'stop-loss' ? 'Stop-Loss' : 'Take-Profit',
    };

    // 4. Update the triggered protective order
    const executedProtOrder: ProtectiveOrder = {
      ...currentProt,
      status: 'executed',
      triggeredAt: now,
      executedAt: now,
      executionPrice: execPrice,
      fee,
      realizedPnl,
      executionOrderId: orderId,
    };
    protectiveMap.set(protOrder.id, executedProtOrder);
    executedOrdersList.push(executedProtOrder);
    generatedExecutions.push(execution);
    generatedOrders.push(tradeOrder);

    // 5. Cancel opposite linked order in the same OCO group
    handledGroupIds.add(protOrder.groupId);

    for (const [id, candidate] of protectiveMap.entries()) {
      if (
        candidate.groupId === protOrder.groupId &&
        candidate.id !== protOrder.id &&
        candidate.status === 'active' &&
        canTransitionProtectiveStatus(candidate.status, 'cancelled')
      ) {
        const canceledCandidate: ProtectiveOrder = {
          ...candidate,
          status: 'cancelled',
        };
        protectiveMap.set(id, canceledCandidate);
        canceledOrdersList.push(canceledCandidate);
      }
    }
  }

  if (executedOrdersList.length === 0) {
    return {
      newState: {
        ...state,
        protectiveOrders: Array.from(protectiveMap.values()),
      },
      triggeredOrders: [],
      canceledOrders: [],
      executions: [],
      orders: [],
    };
  }

  const finalProtectiveOrders = Array.from(protectiveMap.values());

  return {
    newState: {
      ...state,
      usdtBalance: newUsdtBalance.toDecimalPlaces(4, Decimal.ROUND_HALF_UP).toNumber(),
      positions: newPositions,
      protectiveOrders: finalProtectiveOrders,
      orders: [...generatedOrders, ...state.orders],
      executions: [...generatedExecutions, ...state.executions],
      totalRealizedPnl: newRealizedPnl.toDecimalPlaces(4, Decimal.ROUND_HALF_UP).toNumber(),
      totalFeesPaid: newFeesPaid.toDecimalPlaces(4, Decimal.ROUND_HALF_UP).toNumber(),
    },
    triggeredOrders: executedOrdersList,
    canceledOrders: canceledOrdersList,
    executions: generatedExecutions,
    orders: generatedOrders,
  };
}
