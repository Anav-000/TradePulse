import { useState } from 'react';
import { useTradingStore } from '@/features/trading/stores/useTradingStore';
import { useMarketStore } from '@/stores/useMarketStore';
import {
  formatCurrency,
  formatPercentage,
  formatOrderBookQuantity,
} from '@/lib/formatters';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import {
  Layers,
  Clock,
  CheckCircle2,
  TrendingUp,
  TrendingDown,
  Shield,
  ShieldCheck,
} from 'lucide-react';

export function BottomDock() {
  const [activeTab, setActiveTab] = useState<'positions' | 'orders' | 'protection' | 'history'>('positions');
  const {
    positions,
    orders,
    executions,
    protectiveOrders,
    cancelOrder,
    cancelProtectiveOrder,
    closePosition,
    isSubmitting,
  } = useTradingStore();
  const { tickers, setSelectedSymbol } = useMarketStore();

  const openPositionsList = Object.values(positions).filter((p) => p && p.quantity > 0);
  const openOrdersList = orders.filter((o) => o.status === 'pending');
  const allProtectiveList = protectiveOrders || [];
  const activeProtectiveList = allProtectiveList.filter((p) => p.status === 'active');

  // Fast price lookup
  const priceMap: Record<string, number> = {};
  tickers.forEach((t) => {
    priceMap[t.symbol] = t.lastPrice;
  });

  return (
    <div className="rounded-lg border border-[#1e273a] bg-[#0c101a] overflow-hidden min-h-[220px] flex flex-col select-none">
      {/* Dock navigation tabs */}
      <div className="flex items-center justify-between border-b border-[#182030] bg-[#090d16] px-3">
        <div className="flex items-center gap-4">
          <button
            onClick={() => setActiveTab('positions')}
            className={cn(
              'py-2.5 text-xs font-medium border-b-2 transition-colors flex items-center gap-1.5',
              activeTab === 'positions'
                ? 'border-cyan-500 text-cyan-400 font-semibold'
                : 'border-transparent text-slate-400 hover:text-slate-200'
            )}
          >
            <span>Positions</span>
            <span
              className={cn(
                'rounded-full px-1.5 py-0.2 text-[10px] font-mono',
                openPositionsList.length > 0
                  ? 'bg-cyan-500/20 text-cyan-300 font-bold'
                  : 'bg-[#182030] text-slate-500'
              )}
            >
              {openPositionsList.length}
            </span>
          </button>

          <button
            onClick={() => setActiveTab('orders')}
            className={cn(
              'py-2.5 text-xs font-medium border-b-2 transition-colors flex items-center gap-1.5',
              activeTab === 'orders'
                ? 'border-cyan-500 text-cyan-400 font-semibold'
                : 'border-transparent text-slate-400 hover:text-slate-200'
            )}
          >
            <span>Open Orders</span>
            <span
              className={cn(
                'rounded-full px-1.5 py-0.2 text-[10px] font-mono',
                openOrdersList.length > 0
                  ? 'bg-amber-500/20 text-amber-300 font-bold'
                  : 'bg-[#182030] text-slate-500'
              )}
            >
              {openOrdersList.length}
            </span>
          </button>

          <button
            onClick={() => setActiveTab('protection')}
            className={cn(
              'py-2.5 text-xs font-medium border-b-2 transition-colors flex items-center gap-1.5',
              activeTab === 'protection'
                ? 'border-purple-400 text-purple-400 font-semibold'
                : 'border-transparent text-slate-400 hover:text-slate-200'
            )}
          >
            <Shield className="h-3.5 w-3.5" />
            <span>Protection (TP/SL)</span>
            <span
              className={cn(
                'rounded-full px-1.5 py-0.2 text-[10px] font-mono',
                activeProtectiveList.length > 0
                  ? 'bg-purple-500/20 text-purple-300 font-bold'
                  : 'bg-[#182030] text-slate-500'
              )}
            >
              {activeProtectiveList.length}
            </span>
          </button>

          <button
            onClick={() => setActiveTab('history')}
            className={cn(
              'py-2.5 text-xs font-medium border-b-2 transition-colors flex items-center gap-1.5',
              activeTab === 'history'
                ? 'border-cyan-500 text-cyan-400 font-semibold'
                : 'border-transparent text-slate-400 hover:text-slate-200'
            )}
          >
            <span>Trade History</span>
            <span
              className={cn(
                'rounded-full px-1.5 py-0.2 text-[10px] font-mono',
                executions.length > 0
                  ? 'bg-emerald-500/20 text-emerald-300'
                  : 'bg-[#182030] text-slate-500'
              )}
            >
              {executions.length}
            </span>
          </button>
        </div>

        <div className="text-[11px] text-slate-500 hidden sm:flex items-center gap-1.5">
          <Clock className="h-3 w-3 text-cyan-400" />
          <span>Full-Fill Simulation Engine</span>
        </div>
      </div>

      {/* Dock tab content */}
      <div className="flex-1 overflow-x-auto">
        {/* 1. POSITIONS TAB */}
        {activeTab === 'positions' && (
          openPositionsList.length === 0 ? (
            <div className="h-40 flex flex-col items-center justify-center p-6 text-center text-slate-500">
              <Layers className="h-7 w-7 text-slate-600 mb-2" />
              <p className="text-xs font-medium text-slate-400">No active positions yet</p>
              <p className="text-[11px] text-slate-500 max-w-sm mt-0.5">
                Submit a paper trade order from the order panel to simulate real-time position tracking and mark-to-market P&L.
              </p>
            </div>
          ) : (
            <table className="w-full text-left text-xs">
              <thead className="bg-[#090d16] text-[10px] text-slate-500 uppercase font-mono border-b border-[#182030]">
                <tr>
                  <th className="py-2 px-3">Symbol</th>
                  <th className="py-2 px-3">Size / Available</th>
                  <th className="py-2 px-3">Avg Entry Price</th>
                  <th className="py-2 px-3">Mark Price</th>
                  <th className="py-2 px-3">Market Value</th>
                  <th className="py-2 px-3">Unrealized P&L</th>
                  <th className="py-2 px-3 text-right">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#151c2b] font-mono">
                {openPositionsList.map((pos) => {
                  const currentPrice = priceMap[pos.symbol] || pos.averageEntryPrice;
                  const marketValue = pos.quantity * currentPrice;
                  const unrealizedPnl = marketValue - pos.totalCostBasis;
                  const unrealizedPnlPercent =
                    pos.totalCostBasis > 0 ? (unrealizedPnl / pos.totalCostBasis) * 100 : 0;
                  const isProfit = unrealizedPnl >= 0;

                  return (
                    <tr key={pos.symbol} className="hover:bg-[#111724] transition-colors">
                      <td className="py-2.5 px-3">
                        <button
                          onClick={() => setSelectedSymbol(pos.symbol)}
                          className="font-bold text-white hover:text-cyan-400 flex items-center gap-1"
                        >
                          <span>{pos.baseAsset}</span>
                          <span className="text-[10px] text-slate-500 font-normal">/{pos.quoteAsset}</span>
                        </button>
                      </td>
                      <td className="py-2.5 px-3 text-slate-200">
                        <div>{formatOrderBookQuantity(pos.quantity)} {pos.baseAsset}</div>
                        {pos.reservedQuantity > 0 && (
                          <div className="text-[10px] text-purple-400 flex items-center gap-0.5">
                            <ShieldCheck className="h-2.5 w-2.5" />
                            <span>Protected: {formatOrderBookQuantity(pos.reservedQuantity)}</span>
                          </div>
                        )}
                      </td>
                      <td className="py-2.5 px-3 text-slate-300">
                        {formatCurrency(pos.averageEntryPrice)}
                      </td>
                      <td className="py-2.5 px-3 text-white font-medium">
                        {formatCurrency(currentPrice)}
                      </td>
                      <td className="py-2.5 px-3 text-slate-200">
                        {formatCurrency(marketValue)}
                      </td>
                      <td className="py-2.5 px-3">
                        <div
                          className={cn(
                            'font-semibold flex items-center gap-1',
                            isProfit ? 'text-emerald-400' : 'text-rose-400'
                          )}
                        >
                          {isProfit ? (
                            <TrendingUp className="h-3 w-3 shrink-0" />
                          ) : (
                            <TrendingDown className="h-3 w-3 shrink-0" />
                          )}
                          <span>
                            {isProfit ? '+' : ''}
                            {formatCurrency(unrealizedPnl)}
                          </span>
                          <span className="text-[10px] opacity-80">
                            ({formatPercentage(unrealizedPnlPercent)})
                          </span>
                        </div>
                      </td>
                      <td className="py-2.5 px-3 text-right">
                        <Button
                          variant="outline"
                          size="sm"
                          disabled={isSubmitting || pos.availableQuantity <= 0}
                          onClick={() => closePosition(pos.symbol)}
                          className="h-6 text-[10px] font-sans border-rose-900/40 text-rose-300 hover:bg-rose-950/40 hover:text-rose-200"
                        >
                          Quick Close
                        </Button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )
        )}

        {/* 2. OPEN ORDERS TAB */}
        {activeTab === 'orders' && (
          openOrdersList.length === 0 ? (
            <div className="h-40 flex flex-col items-center justify-center p-6 text-center text-slate-500">
              <Clock className="h-7 w-7 text-slate-600 mb-2" />
              <p className="text-xs font-medium text-slate-400">No open limit orders</p>
              <p className="text-[11px] text-slate-500 max-w-sm mt-0.5">
                Place a limit buy or sell order from the order panel to test real-time client-side order matching.
              </p>
            </div>
          ) : (
            <table className="w-full text-left text-xs">
              <thead className="bg-[#090d16] text-[10px] text-slate-500 uppercase font-mono border-b border-[#182030]">
                <tr>
                  <th className="py-2 px-3">Order ID</th>
                  <th className="py-2 px-3">Created</th>
                  <th className="py-2 px-3">Symbol</th>
                  <th className="py-2 px-3">Side</th>
                  <th className="py-2 px-3">Limit Price</th>
                  <th className="py-2 px-3">Quantity</th>
                  <th className="py-2 px-3">Reserved</th>
                  <th className="py-2 px-3">Status</th>
                  <th className="py-2 px-3 text-right">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#151c2b] font-mono">
                {openOrdersList.map((order) => {
                  const isBuy = order.side === 'buy';

                  return (
                    <tr key={order.id} className="hover:bg-[#111724] transition-colors">
                      <td className="py-2.5 px-3 text-[11px] text-slate-400">
                        #{order.id.slice(-6)}
                      </td>
                      <td className="py-2.5 px-3 text-[11px] text-slate-400">
                        {new Date(order.createdAt).toLocaleTimeString()}
                      </td>
                      <td className="py-2.5 px-3 text-white font-semibold">
                        {order.symbol}
                      </td>
                      <td className="py-2.5 px-3">
                        <Badge
                          variant={isBuy ? 'buy' : 'sell'}
                          className="text-[9px] px-1.5 py-0 uppercase"
                        >
                          {order.side}
                        </Badge>
                      </td>
                      <td className="py-2.5 px-3 text-slate-200">
                        {formatCurrency(order.price)}
                      </td>
                      <td className="py-2.5 px-3 text-slate-200">
                        {order.quantity} {order.baseAsset}
                      </td>
                      <td className="py-2.5 px-3 text-slate-300">
                        {isBuy
                          ? formatCurrency(order.reservedAmount)
                          : `${order.reservedAmount} ${order.baseAsset}`}
                      </td>
                      <td className="py-2.5 px-3">
                        <Badge variant="accent" className="text-[9px] px-1.5 py-0 uppercase">
                          {order.status}
                        </Badge>
                      </td>
                      <td className="py-2.5 px-3 text-right">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => cancelOrder(order.id)}
                          className="h-6 text-[10px] text-slate-400 hover:text-rose-400 hover:bg-rose-950/20"
                        >
                          Cancel
                        </Button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )
        )}

        {/* 3. PROTECTION (TP/SL) TAB */}
        {activeTab === 'protection' && (
          allProtectiveList.length === 0 ? (
            <div className="h-40 flex flex-col items-center justify-center p-6 text-center text-slate-500">
              <Shield className="h-7 w-7 text-slate-600 mb-2" />
              <p className="text-xs font-medium text-slate-400">No protective orders active</p>
              <p className="text-[11px] text-slate-500 max-w-sm mt-0.5">
                Set Stop-Loss and Take-Profit triggers from the order panel to automatically protect your holdings from market volatility.
              </p>
            </div>
          ) : (
            <table className="w-full text-left text-xs">
              <thead className="bg-[#090d16] text-[10px] text-slate-500 uppercase font-mono border-b border-[#182030]">
                <tr>
                  <th className="py-2 px-3">Trigger ID</th>
                  <th className="py-2 px-3">Created</th>
                  <th className="py-2 px-3">Symbol</th>
                  <th className="py-2 px-3">Trigger Type</th>
                  <th className="py-2 px-3">Trigger Price</th>
                  <th className="py-2 px-3">Current Bid / Distance</th>
                  <th className="py-2 px-3">Protected Qty</th>
                  <th className="py-2 px-3">Link Type</th>
                  <th className="py-2 px-3">Status</th>
                  <th className="py-2 px-3 text-right">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#151c2b] font-mono">
                {allProtectiveList.map((prot) => {
                  const isSl = prot.triggerType === 'stop-loss';
                  const currentBid = priceMap[prot.symbol] || 0;
                  const distance =
                    currentBid > 0 ? ((prot.triggerPrice - currentBid) / currentBid) * 100 : 0;
                  const isLinked = allProtectiveList.some(
                    (p) => p.groupId === prot.groupId && p.id !== prot.id
                  );

                  return (
                    <tr key={prot.id} className="hover:bg-[#111724] transition-colors">
                      <td className="py-2.5 px-3 text-[11px] text-slate-400">
                        #{prot.id.slice(-6)}
                      </td>
                      <td className="py-2.5 px-3 text-[11px] text-slate-400">
                        {new Date(prot.createdAt).toLocaleTimeString()}
                      </td>
                      <td className="py-2.5 px-3">
                        <button
                          onClick={() => setSelectedSymbol(prot.symbol)}
                          className="font-bold text-white hover:text-cyan-400"
                        >
                          {prot.symbol}
                        </button>
                      </td>
                      <td className="py-2.5 px-3">
                        <Badge
                          variant={isSl ? 'sell' : 'buy'}
                          className="text-[9px] px-1.5 py-0 uppercase"
                        >
                          {isSl ? 'Stop-Loss' : 'Take-Profit'}
                        </Badge>
                      </td>
                      <td className="py-2.5 px-3 text-white font-semibold">
                        {formatCurrency(prot.triggerPrice)}
                      </td>
                      <td className="py-2.5 px-3 text-slate-300">
                        <span>{currentBid > 0 ? formatCurrency(currentBid) : '—'} </span>
                        {currentBid > 0 && (
                          <span
                            className={cn(
                              'text-[10px]',
                              distance >= 0 ? 'text-emerald-400' : 'text-rose-400'
                            )}
                          >
                            ({distance >= 0 ? '+' : ''}{distance.toFixed(2)}%)
                          </span>
                        )}
                      </td>
                      <td className="py-2.5 px-3 text-slate-200">
                        {prot.quantity} {prot.baseAsset}
                      </td>
                      <td className="py-2.5 px-3 text-[10px]">
                        {isLinked ? (
                          <span className="text-purple-300 bg-purple-950/40 border border-purple-800/40 px-1.5 py-0.5 rounded">
                            Linked OCO
                          </span>
                        ) : (
                          <span className="text-slate-400">Standalone</span>
                        )}
                      </td>
                      <td className="py-2.5 px-3">
                        <Badge
                          variant={
                            prot.status === 'executed'
                              ? 'buy'
                              : prot.status === 'failed'
                              ? 'sell'
                              : prot.status === 'active'
                              ? 'accent'
                              : 'secondary'
                          }
                          className="text-[9px] px-1.5 py-0 uppercase"
                        >
                          {prot.status}
                        </Badge>
                      </td>
                      <td className="py-2.5 px-3 text-right">
                        {prot.status === 'active' ? (
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => cancelProtectiveOrder(prot.id)}
                            className="h-6 text-[10px] text-slate-400 hover:text-rose-400 hover:bg-rose-950/20"
                          >
                            Cancel
                          </Button>
                        ) : (
                          <span className="text-[10px] text-slate-500">—</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )
        )}

        {/* 4. TRADE HISTORY TAB */}
        {activeTab === 'history' && (
          executions.length === 0 ? (
            <div className="h-40 flex flex-col items-center justify-center p-6 text-center text-slate-500">
              <CheckCircle2 className="h-7 w-7 text-slate-600 mb-2" />
              <p className="text-xs font-medium text-slate-400">No trade executions yet</p>
              <p className="text-[11px] text-slate-500 max-w-sm mt-0.5">
                Filled market, limit, and protective orders will appear here in chronological order with realized P&L and simulated fees.
              </p>
            </div>
          ) : (
            <table className="w-full text-left text-xs">
              <thead className="bg-[#090d16] text-[10px] text-slate-500 uppercase font-mono border-b border-[#182030]">
                <tr>
                  <th className="py-2 px-3">Exec ID</th>
                  <th className="py-2 px-3">Time</th>
                  <th className="py-2 px-3">Symbol</th>
                  <th className="py-2 px-3">Side</th>
                  <th className="py-2 px-3">Type</th>
                  <th className="py-2 px-3">Price</th>
                  <th className="py-2 px-3">Quantity</th>
                  <th className="py-2 px-3">Gross Value</th>
                  <th className="py-2 px-3">Fee</th>
                  <th className="py-2 px-3 text-right">Realized P&L</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#151c2b] font-mono">
                {executions.map((exec) => {
                  const isBuy = exec.side === 'buy';
                  const matchingOrder = orders.find((o) => o.id === exec.orderId);

                  return (
                    <tr key={exec.id} className="hover:bg-[#111724] transition-colors">
                      <td className="py-2 px-3 text-[11px] text-slate-400">
                        #{exec.id.slice(-6)}
                      </td>
                      <td className="py-2 px-3 text-[11px] text-slate-400">
                        {new Date(exec.timestamp).toLocaleTimeString()}
                      </td>
                      <td className="py-2.5 px-3 text-white font-semibold">
                        {exec.symbol}
                      </td>
                      <td className="py-2 px-3">
                        <Badge
                          variant={isBuy ? 'buy' : 'sell'}
                          className="text-[9px] px-1.5 py-0 uppercase"
                        >
                          {exec.side}
                        </Badge>
                      </td>
                      <td className="py-2 px-3 text-[10px]">
                        {matchingOrder?.orderLabel ? (
                          <span
                            className={cn(
                              'px-1.5 py-0.5 rounded font-mono font-bold text-[9px]',
                              matchingOrder.orderLabel === 'Stop-Loss'
                                ? 'bg-rose-950/60 text-rose-300 border border-rose-800/50'
                                : 'bg-emerald-950/60 text-emerald-300 border border-emerald-800/50'
                            )}
                          >
                            {matchingOrder.orderLabel}
                          </span>
                        ) : (
                          <span className="text-slate-400 uppercase">{exec.type}</span>
                        )}
                      </td>
                      <td className="py-2 px-3 text-slate-200">
                        {formatCurrency(exec.price)}
                      </td>
                      <td className="py-2 px-3 text-slate-200">
                        {exec.quantity} {exec.baseAsset}
                      </td>
                      <td className="py-2 px-3 text-slate-300">
                        {formatCurrency(exec.grossValue)}
                      </td>
                      <td className="py-2 px-3 text-slate-400 text-[11px]">
                        {formatCurrency(exec.fee)}
                      </td>
                      <td className="py-2 px-3 text-right">
                        {exec.realizedPnl !== undefined ? (
                          <span
                            className={cn(
                              'font-semibold',
                              exec.realizedPnl >= 0 ? 'text-emerald-400' : 'text-rose-400'
                            )}
                          >
                            {exec.realizedPnl >= 0 ? '+' : ''}
                            {formatCurrency(exec.realizedPnl)}
                          </span>
                        ) : (
                          <span className="text-slate-500">—</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )
        )}
      </div>
    </div>
  );
}
