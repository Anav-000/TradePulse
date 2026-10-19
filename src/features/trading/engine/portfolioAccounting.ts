import Decimal from 'decimal.js';
import { Position, TradeExecution, PortfolioStats } from '../types';

export const INITIAL_CAPITAL = 50_000.00; // 50,000 USDT

/**
 * Applies a Buy execution to an existing or new Position using weighted-average cost basis.
 * Buy fees are capitalized into the total acquisition cost basis.
 */
export function applyBuyToPosition(
  currentPosition: Position | undefined,
  execution: TradeExecution
): Position {
  const dExecQty = new Decimal(execution.quantity);
  const dExecCost = new Decimal(execution.grossValue).add(execution.fee);

  if (!currentPosition || currentPosition.quantity <= 0) {
    const qty = dExecQty.toDecimalPlaces(8, Decimal.ROUND_HALF_UP).toNumber();
    const costBasis = dExecCost.toDecimalPlaces(4, Decimal.ROUND_HALF_UP).toNumber();
    const avgPrice = dExecCost.div(dExecQty).toDecimalPlaces(4, Decimal.ROUND_HALF_UP).toNumber();

    return {
      symbol: execution.symbol,
      baseAsset: execution.baseAsset,
      quoteAsset: execution.quoteAsset,
      quantity: qty,
      reservedQuantity: 0,
      availableQuantity: qty,
      averageEntryPrice: avgPrice,
      totalCostBasis: costBasis,
      realizedPnl: currentPosition ? currentPosition.realizedPnl : 0,
      openedAt: currentPosition?.openedAt || execution.timestamp,
      updatedAt: execution.timestamp,
    };
  }

  const dOldQty = new Decimal(currentPosition.quantity);
  const dOldCost = new Decimal(currentPosition.totalCostBasis);

  const dNewQty = dOldQty.add(dExecQty);
  const dNewCost = dOldCost.add(dExecCost);
  const dNewAvg = dNewCost.div(dNewQty);

  const newQty = dNewQty.toDecimalPlaces(8, Decimal.ROUND_HALF_UP).toNumber();
  const reserved = currentPosition.reservedQuantity;
  const avail = Math.max(0, newQty - reserved);

  return {
    ...currentPosition,
    quantity: newQty,
    availableQuantity: avail,
    totalCostBasis: dNewCost.toDecimalPlaces(4, Decimal.ROUND_HALF_UP).toNumber(),
    averageEntryPrice: dNewAvg.toDecimalPlaces(4, Decimal.ROUND_HALF_UP).toNumber(),
    updatedAt: execution.timestamp,
  };
}

/**
 * Applies a Sell execution to a Position, proportionally reducing the cost basis
 * and calculating realized P&L.
 */
export function applySellToPosition(
  currentPosition: Position,
  execution: TradeExecution
): { updatedPosition: Position | null; realizedPnl: number } {
  const dOldQty = new Decimal(currentPosition.quantity);
  const dOldCost = new Decimal(currentPosition.totalCostBasis);
  const dSoldQty = new Decimal(execution.quantity);

  if (dOldQty.isZero() || dSoldQty.greaterThan(dOldQty)) {
    throw new Error(`Cannot sell ${execution.quantity} with only ${currentPosition.quantity} held.`);
  }

  // Cost basis of sold quantity = (soldQty / oldQty) * oldCostBasis
  const dSoldCost = dSoldQty.div(dOldQty).mul(dOldCost);

  // Net proceeds = grossValue - fee
  const dNetProceeds = new Decimal(execution.grossValue).sub(execution.fee);

  // Realized P&L = Net proceeds - cost of sold quantity
  const dRealizedPnl = dNetProceeds.sub(dSoldCost);
  const realizedPnl = dRealizedPnl.toDecimalPlaces(4, Decimal.ROUND_HALF_UP).toNumber();

  const dRemainingQty = dOldQty.sub(dSoldQty);
  const dRemainingCost = dOldCost.sub(dSoldCost);

  const remainingQty = dRemainingQty.toDecimalPlaces(8, Decimal.ROUND_HALF_UP).toNumber();
  const cumRealizedPnl = new Decimal(currentPosition.realizedPnl).add(dRealizedPnl).toDecimalPlaces(4, Decimal.ROUND_HALF_UP).toNumber();

  if (remainingQty <= 0.00000001) {
    // Position fully closed
    return {
      updatedPosition: null,
      realizedPnl,
    };
  }

  const remainingCost = dRemainingCost.greaterThan(0)
    ? dRemainingCost.toDecimalPlaces(4, Decimal.ROUND_HALF_UP).toNumber()
    : 0;

  const avgPrice = remainingCost > 0
    ? dRemainingCost.div(dRemainingQty).toDecimalPlaces(4, Decimal.ROUND_HALF_UP).toNumber()
    : 0;

  const reserved = Math.min(currentPosition.reservedQuantity, remainingQty);
  const avail = Math.max(0, remainingQty - reserved);

  const updatedPosition: Position = {
    ...currentPosition,
    quantity: remainingQty,
    reservedQuantity: reserved,
    availableQuantity: avail,
    totalCostBasis: remainingCost,
    averageEntryPrice: avgPrice,
    realizedPnl: cumRealizedPnl,
    updatedAt: execution.timestamp,
  };

  return { updatedPosition, realizedPnl };
}

/**
 * Calculates current mark-to-market valuation of positions and overall portfolio stats.
 */
export function calculatePortfolioStats(
  usdtBalance: number,
  usdtReserved: number,
  positions: Record<string, Position>,
  marketPrices: Record<string, number>,
  totalFeesPaid: number,
  totalRealizedPnl: number,
  initialCapital: number = INITIAL_CAPITAL
): PortfolioStats {
  const dUsdt = new Decimal(usdtBalance);
  const dReserved = new Decimal(usdtReserved);
  const dAvailUsdt = Decimal.max(0, dUsdt.sub(dReserved));

  let dInvestedValue = new Decimal(0);
  let dTotalCostBasis = new Decimal(0);

  for (const pos of Object.values(positions)) {
    if (!pos || pos.quantity <= 0) continue;
    const price = marketPrices[pos.symbol] || pos.averageEntryPrice || 0;
    const dVal = new Decimal(pos.quantity).mul(price);
    dInvestedValue = dInvestedValue.add(dVal);
    dTotalCostBasis = dTotalCostBasis.add(pos.totalCostBasis);
  }

  const dTotalEquity = dUsdt.add(dInvestedValue);
  const dUnrealizedPnl = dInvestedValue.sub(dTotalCostBasis);

  const unrealizedPnlPercent = dTotalCostBasis.greaterThan(0)
    ? dUnrealizedPnl.div(dTotalCostBasis).mul(100).toDecimalPlaces(2, Decimal.ROUND_HALF_UP).toNumber()
    : 0;

  const dInitial = new Decimal(initialCapital);
  const totalReturnPercent = dInitial.greaterThan(0)
    ? dTotalEquity.sub(dInitial).div(dInitial).mul(100).toDecimalPlaces(2, Decimal.ROUND_HALF_UP).toNumber()
    : 0;

  return {
    totalEquity: dTotalEquity.toDecimalPlaces(2, Decimal.ROUND_HALF_UP).toNumber(),
    availableUsdt: dAvailUsdt.toDecimalPlaces(2, Decimal.ROUND_HALF_UP).toNumber(),
    reservedUsdt: dReserved.toDecimalPlaces(2, Decimal.ROUND_HALF_UP).toNumber(),
    totalUsdt: dUsdt.toDecimalPlaces(2, Decimal.ROUND_HALF_UP).toNumber(),
    investedValue: dInvestedValue.toDecimalPlaces(2, Decimal.ROUND_HALF_UP).toNumber(),
    unrealizedPnl: dUnrealizedPnl.toDecimalPlaces(2, Decimal.ROUND_HALF_UP).toNumber(),
    unrealizedPnlPercent,
    realizedPnl: new Decimal(totalRealizedPnl).toDecimalPlaces(2, Decimal.ROUND_HALF_UP).toNumber(),
    totalFeesPaid: new Decimal(totalFeesPaid).toDecimalPlaces(2, Decimal.ROUND_HALF_UP).toNumber(),
    totalReturnPercent,
  };
}
