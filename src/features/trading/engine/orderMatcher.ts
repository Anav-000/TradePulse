import { TradeOrder, TradeExecution, LiveQuote } from '../types';
import { calculateGrossValue, calculateFee, DEFAULT_FEE_RATE } from './feeCalculator';
import { isQuoteFresh } from './orderValidator';
import { canTransitionOrderStatus } from './orderLifecycle';

export interface MatchResult {
  filledOrders: TradeOrder[];
  executions: TradeExecution[];
  remainingPendingOrders: TradeOrder[];
}

/**
 * Evaluates pending limit orders against current market quotes.
 * Deterministic full-fill simulation policy:
 * - Limit Buy fills when askPrice <= limitPrice (execution at current Ask)
 * - Limit Sell fills when bidPrice >= limitPrice (execution at current Bid)
 * - Quotes exceeding MAX_QUOTE_AGE_MS or non-finite are strictly treated as stale and rejected
 */
export function matchPendingOrders(
  pendingOrders: TradeOrder[],
  quotes: Record<string, LiveQuote>,
  feeRate: number = DEFAULT_FEE_RATE,
  now: number = Date.now()
): MatchResult {
  const filledOrders: TradeOrder[] = [];
  const executions: TradeExecution[] = [];
  const remainingPendingOrders: TradeOrder[] = [];

  for (const order of pendingOrders) {
    if (order.status !== 'pending' || !canTransitionOrderStatus(order.status, 'filled')) {
      continue;
    }

    const quote = quotes[order.symbol];
    if (!isQuoteFresh(quote, now)) {
      remainingPendingOrders.push(order);
      continue;
    }

    let isEligible = false;
    let fillPrice = 0;

    if (order.side === 'buy') {
      if (quote.askPrice <= order.price) {
        isEligible = true;
        fillPrice = quote.askPrice;
      }
    } else {
      if (quote.bidPrice >= order.price) {
        isEligible = true;
        fillPrice = quote.bidPrice;
      }
    }

    if (!isEligible) {
      remainingPendingOrders.push(order);
      continue;
    }

    const grossValue = calculateGrossValue(fillPrice, order.quantity);
    const fee = calculateFee(grossValue, feeRate);
    const netValue = order.side === 'buy' ? grossValue + fee : grossValue - fee;

    const executionId = `exec_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
    const execution: TradeExecution = {
      id: executionId,
      orderId: order.id,
      symbol: order.symbol,
      baseAsset: order.baseAsset,
      quoteAsset: order.quoteAsset,
      side: order.side,
      type: 'limit',
      price: fillPrice,
      quantity: order.quantity,
      grossValue,
      fee,
      netValue,
      timestamp: now,
    };

    const updatedOrder: TradeOrder = {
      ...order,
      status: 'filled',
      filledPrice: fillPrice,
      filledQuantity: order.quantity,
      fee,
      filledAt: now,
    };

    filledOrders.push(updatedOrder);
    executions.push(execution);
  }

  return {
    filledOrders,
    executions,
    remainingPendingOrders,
  };
}
