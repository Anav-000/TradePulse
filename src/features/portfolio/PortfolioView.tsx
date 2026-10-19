import { useState } from 'react';
import { useUIStore } from '@/stores/useUIStore';
import { useMarketStore } from '@/stores/useMarketStore';
import { useTradingStore } from '@/features/trading/stores/useTradingStore';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Wallet,
  RefreshCw,
  PieChart,
  ShieldCheck,
  TrendingUp,
  Clock,
  Layers,
  ArrowRight,
  AlertTriangle,
  Receipt,
  DollarSign,
} from 'lucide-react';
import {
  formatCurrency,
  formatPercentage,
  formatOrderBookQuantity,
} from '@/lib/formatters';
import { cn } from '@/lib/utils';
import { PortfolioDonutChart, DonutChartItem } from './PortfolioDonutChart';
import { PortfolioEquityChart } from './PortfolioEquityChart';

export function PortfolioView() {
  const { setActiveView } = useUIStore();
  const { tickers, setSelectedSymbol } = useMarketStore();
  const {
    positions,
    equitySnapshots,
    getPortfolioStats,
    resetAccount,
  } = useTradingStore();

  const [showResetConfirm, setShowResetConfirm] = useState(false);
  const [resetSuccessMessage, setResetSuccessMessage] = useState(false);

  const stats = getPortfolioStats();
  const isOverallProfit = stats.unrealizedPnl >= 0;
  const isReturnPositive = stats.totalReturnPercent >= 0;

  // Price lookup map
  const priceMap: Record<string, number> = {};
  tickers.forEach((t) => {
    priceMap[t.symbol] = t.lastPrice;
  });

  const activeHoldings = Object.values(positions).filter((p) => p && p.quantity > 0);

  // Asset allocation calculations
  const totalEquity = Math.max(stats.totalEquity, 0.01);
  const usdtAllocationPercent = Math.max(0, (stats.totalUsdt / totalEquity) * 100);

  const holdingsWithAllocation = activeHoldings.map((pos) => {
    const currentPrice = priceMap[pos.symbol] || pos.averageEntryPrice;
    const marketValue = pos.quantity * currentPrice;
    const allocationPercent = Math.max(0, (marketValue / totalEquity) * 100);
    const unrealizedPnl = marketValue - pos.totalCostBasis;
    const unrealizedPercent =
      pos.totalCostBasis > 0 ? (unrealizedPnl / pos.totalCostBasis) * 100 : 0;

    return {
      ...pos,
      currentPrice,
      marketValue,
      allocationPercent,
      unrealizedPnl,
      unrealizedPercent,
    };
  });

  const handleConfirmReset = () => {
    resetAccount();
    setShowResetConfirm(false);
    setResetSuccessMessage(true);
    setTimeout(() => setResetSuccessMessage(false), 4000);
  };

  const handleQuickTrade = (symbol: string) => {
    setSelectedSymbol(symbol);
    setActiveView('terminal');
  };

  // Color palette for asset allocation donut
  const assetColors = ['#10b981', '#06b6d4', '#6366f1', '#f59e0b', '#ec4899', '#8b5cf6', '#14b8a6', '#f97316'];

  return (
    <div className="space-y-4 p-4 lg:p-6 select-none">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-white tracking-tight flex items-center gap-2">
            <span>Virtual Portfolio & P&L</span>
            <Badge variant="simulated">Paper Money</Badge>
          </h1>
          <p className="text-xs text-slate-400">
            Real-time simulated balances, mark-to-market positions, capital allocation, and performance metrics.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setShowResetConfirm(true)}
            className="text-xs text-slate-300 border-[#232c3f] hover:bg-rose-950/30 hover:border-rose-900/50 hover:text-rose-200"
          >
            <RefreshCw className="mr-1.5 h-3.5 w-3.5 text-cyan-400" />
            Reset Paper Wallet
          </Button>
        </div>
      </div>

      {/* Reset Success Banner */}
      {resetSuccessMessage && (
        <div className="rounded-md border border-emerald-500/30 bg-emerald-950/30 p-2.5 text-xs text-emerald-300 flex items-center gap-2 animate-in fade-in duration-200">
          <ShieldCheck className="h-4 w-4" />
          <span>Paper wallet reset successfully to $50,000.00 USDT initial simulation capital.</span>
        </div>
      )}

      {/* Reset Confirmation Modal */}
      {showResetConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-sm p-4">
          <div className="w-full max-w-md rounded-lg border border-[#26334d] bg-[#0c101a] p-5 shadow-2xl space-y-4">
            <div className="flex items-start gap-3">
              <div className="rounded-full bg-rose-500/15 p-2 text-rose-400 border border-rose-500/30 shrink-0">
                <AlertTriangle className="h-5 w-5" />
              </div>
              <div>
                <h3 className="text-sm font-bold text-white">Reset Simulated Portfolio?</h3>
                <p className="text-xs text-slate-400 mt-1">
                  This will permanently clear all simulated positions, open limit orders, and execution history, returning your wallet to its initial $50,000.00 USDT balance.
                </p>
              </div>
            </div>

            <div className="flex justify-end gap-2 pt-2 border-t border-[#1a2336]">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setShowResetConfirm(false)}
                className="text-xs text-slate-300 border-[#232c3f]"
              >
                Cancel
              </Button>
              <Button
                variant="sell"
                size="sm"
                onClick={handleConfirmReset}
                className="text-xs bg-rose-600 hover:bg-rose-700 text-white"
              >
                Confirm Reset
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Portfolio Summary Metrics Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
        {/* Total Equity */}
        <Card className="border-[#1e273a] bg-[#0c101a]">
          <CardContent className="p-3.5">
            <div className="flex items-center justify-between text-slate-400 text-xs mb-1">
              <span>Total Simulated Equity</span>
              <Wallet className="h-4 w-4 text-emerald-400" />
            </div>
            <div className="text-xl font-bold font-mono text-white tabular-nums">
              {formatCurrency(stats.totalEquity)}
            </div>
            <div className="flex items-center justify-between text-[11px] font-mono mt-1 text-slate-400">
              <span>Base: $50,000.00</span>
              <span
                className={cn(
                  'font-semibold',
                  isReturnPositive ? 'text-emerald-400' : 'text-rose-400'
                )}
              >
                {formatPercentage(stats.totalReturnPercent)}
              </span>
            </div>
          </CardContent>
        </Card>

        {/* Available Cash & Reserved */}
        <Card className="border-[#1e273a] bg-[#0c101a]">
          <CardContent className="p-3.5">
            <div className="flex items-center justify-between text-slate-400 text-xs mb-1">
              <span>Available Cash (USDT)</span>
              <DollarSign className="h-4 w-4 text-cyan-400" />
            </div>
            <div className="text-xl font-bold font-mono text-slate-200 tabular-nums">
              {formatCurrency(stats.availableUsdt)}
            </div>
            <div className="text-[11px] font-mono text-slate-500 mt-1 flex justify-between">
              <span>Reserved: {formatCurrency(stats.reservedUsdt)}</span>
              <span>Total: {formatCurrency(stats.totalUsdt)}</span>
            </div>
          </CardContent>
        </Card>

        {/* Unrealized P&L */}
        <Card className="border-[#1e273a] bg-[#0c101a]">
          <CardContent className="p-3.5">
            <div className="flex items-center justify-between text-slate-400 text-xs mb-1">
              <span>Unrealized P&L</span>
              <TrendingUp className="h-4 w-4 text-cyan-400" />
            </div>
            <div
              className={cn(
                'text-xl font-bold font-mono tabular-nums',
                stats.unrealizedPnl === 0
                  ? 'text-slate-400'
                  : isOverallProfit
                  ? 'text-emerald-400'
                  : 'text-rose-400'
              )}
            >
              {stats.unrealizedPnl > 0 ? '+' : ''}
              {formatCurrency(stats.unrealizedPnl)}
            </div>
            <div className="text-[11px] font-mono text-slate-400 mt-1 flex justify-between">
              <span>Invested: {formatCurrency(stats.investedValue)}</span>
              <span>{formatPercentage(stats.unrealizedPnlPercent)}</span>
            </div>
          </CardContent>
        </Card>

        {/* Realized P&L & Cumulative Fees */}
        <Card className="border-[#1e273a] bg-[#0c101a]">
          <CardContent className="p-3.5">
            <div className="flex items-center justify-between text-slate-400 text-xs mb-1">
              <span>Realized P&L</span>
              <Receipt className="h-4 w-4 text-emerald-400" />
            </div>
            <div
              className={cn(
                'text-xl font-bold font-mono tabular-nums',
                stats.realizedPnl === 0
                  ? 'text-slate-400'
                  : stats.realizedPnl > 0
                  ? 'text-emerald-400'
                  : 'text-rose-400'
              )}
            >
              {stats.realizedPnl > 0 ? '+' : ''}
              {formatCurrency(stats.realizedPnl)}
            </div>
            <div className="text-[11px] font-mono text-slate-500 mt-1 flex justify-between">
              <span>Total Fees Paid:</span>
              <span className="text-slate-300 font-semibold">{formatCurrency(stats.totalFeesPaid)}</span>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Asset Allocation & Performance Chart Row */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
        {/* Capital Allocation Card */}
        <Card className="border-[#1e273a] bg-[#0c101a] flex flex-col">
          <CardHeader className="p-3.5 border-b border-[#182030] bg-[#090d16]">
            <CardTitle>
              <span className="flex items-center gap-1.5 text-xs text-white">
                <PieChart className="h-4 w-4 text-cyan-400" /> Capital Allocation
              </span>
            </CardTitle>
          </CardHeader>
          <CardContent className="p-4 flex-1 flex flex-col justify-between">
            {(() => {
              const donutItems: DonutChartItem[] = [
                {
                  id: 'USDT',
                  label: 'USDT (Cash)',
                  value: stats.totalUsdt,
                  percent: usdtAllocationPercent,
                  color: '#10b981',
                  isCash: true,
                },
                ...holdingsWithAllocation.map((h, idx) => ({
                  id: h.symbol,
                  label: `${h.baseAsset} (${h.symbol})`,
                  value: h.marketValue,
                  percent: h.allocationPercent,
                  color: assetColors[(idx + 1) % assetColors.length],
                })),
              ];

              return (
                <PortfolioDonutChart
                  items={donutItems}
                  totalEquity={stats.totalEquity}
                  className="w-full"
                />
              );
            })()}

            <p className="text-[10px] text-slate-500 pt-3 mt-2 border-t border-[#182030] text-center">
              Allocation weights adjust continuously as spot prices fluctuate on live exchange feeds.
            </p>
          </CardContent>
        </Card>

        {/* Portfolio Equity Performance Chart */}
        <Card className="border-[#1e273a] bg-[#0c101a] lg:col-span-2 flex flex-col">
          <CardHeader className="p-3.5 border-b border-[#182030] bg-[#090d16] flex flex-row items-center justify-between">
            <CardTitle>
              <span className="flex items-center gap-1.5 text-xs text-white">
                <TrendingUp className="h-4 w-4 text-emerald-400" /> Equity Growth (Recorded Snapshots)
              </span>
            </CardTitle>
            <span className="text-[10px] font-mono text-slate-500">
              {equitySnapshots.length} snapshot{equitySnapshots.length === 1 ? '' : 's'} recorded
            </span>
          </CardHeader>
          <CardContent className="p-4 flex-1 flex flex-col justify-between">
            {/* Dynamic Equity Performance Chart with Hover Tooltips */}
            <PortfolioEquityChart
              equitySnapshots={equitySnapshots}
              currentEquity={stats.totalEquity}
            />

            <div className="text-[11px] text-slate-500 pt-2 border-t border-[#182030] flex items-center justify-between">
              <span>Simulation mode: Zero real exchange risk</span>
              <span className="font-mono text-slate-400">
                Fee rate: 0.05% per trade
              </span>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Holdings Table */}
      <Card className="border-[#1e273a] bg-[#0c101a] overflow-hidden">
        <CardHeader className="p-3.5 border-b border-[#182030] bg-[#090d16]">
          <CardTitle>
            <div className="flex items-center justify-between">
              <span className="flex items-center gap-1.5 text-xs text-white">
                <Layers className="h-4 w-4 text-cyan-400" /> Current Cryptocurrency Holdings ({activeHoldings.length})
              </span>
              <span className="text-[10px] font-mono text-slate-500">
                Mark-to-Market Valuation
              </span>
            </div>
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {activeHoldings.length === 0 ? (
            <div className="p-8 text-center text-slate-500 flex flex-col items-center justify-center">
              <div className="h-10 w-10 rounded-full bg-[#161d2b] flex items-center justify-center text-slate-500 mb-2">
                <Clock className="h-5 w-5" />
              </div>
              <h4 className="font-semibold text-white text-xs">No active cryptocurrency holdings</h4>
              <p className="text-[11px] text-slate-400 max-w-sm mt-1">
                Your paper wallet is currently 100% in USDT cash. Open the trading terminal to place simulated spot buy orders.
              </p>
              <Button
                variant="default"
                size="sm"
                className="mt-4"
                onClick={() => setActiveView('terminal')}
              >
                Go to Trading Terminal
              </Button>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="bg-[#090d16] text-[10px] text-slate-500 uppercase font-mono border-b border-[#182030]">
                  <tr>
                    <th className="py-2.5 px-3">Cryptocurrency</th>
                    <th className="py-2.5 px-3">Total Holdings</th>
                    <th className="py-2.5 px-3">Average Buy Price</th>
                    <th className="py-2.5 px-3">Current Spot Price</th>
                    <th className="py-2.5 px-3">Market Value</th>
                    <th className="py-2.5 px-3">Allocation</th>
                    <th className="py-2.5 px-3">Unrealized P&L</th>
                    <th className="py-2.5 px-3 text-right">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#151c2b] font-mono">
                  {holdingsWithAllocation.map((h) => {
                    const isProfit = h.unrealizedPnl >= 0;

                    return (
                      <tr key={h.symbol} className="hover:bg-[#111724] transition-colors">
                        <td className="py-3 px-3">
                          <div className="flex items-center gap-1.5">
                            <span className="font-bold text-white">{h.baseAsset}</span>
                            <span className="text-[10px] text-slate-500 font-normal">/{h.quoteAsset}</span>
                          </div>
                        </td>
                        <td className="py-3 px-3 text-slate-200">
                          <div>{formatOrderBookQuantity(h.quantity)} {h.baseAsset}</div>
                          {h.reservedQuantity > 0 && (
                            <div className="text-[10px] text-amber-400/80">
                              (Locked in orders: {formatOrderBookQuantity(h.reservedQuantity)})
                            </div>
                          )}
                        </td>
                        <td className="py-3 px-3 text-slate-300">
                          {formatCurrency(h.averageEntryPrice)}
                        </td>
                        <td className="py-3 px-3 text-white font-medium">
                          {formatCurrency(h.currentPrice)}
                        </td>
                        <td className="py-3 px-3 text-slate-100 font-medium">
                          {formatCurrency(h.marketValue)}
                        </td>
                        <td className="py-3 px-3 text-slate-300">
                          {h.allocationPercent.toFixed(1)}%
                        </td>
                        <td className="py-3 px-3">
                          <span
                            className={cn(
                              'font-semibold flex items-center gap-1',
                              isProfit ? 'text-emerald-400' : 'text-rose-400'
                            )}
                          >
                            {isProfit ? '+' : ''}
                            {formatCurrency(h.unrealizedPnl)}
                            <span className="text-[10px] opacity-80">
                              ({formatPercentage(h.unrealizedPercent)})
                            </span>
                          </span>
                        </td>
                        <td className="py-3 px-3 text-right">
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => handleQuickTrade(h.symbol)}
                            className="h-6 text-[10px] font-sans border-cyan-800/40 text-cyan-300 hover:bg-cyan-950/40 hover:text-cyan-200"
                          >
                            Trade <ArrowRight className="ml-1 h-3 w-3" />
                          </Button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
