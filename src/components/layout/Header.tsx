import { useMarketStore } from '@/stores/useMarketStore';
import { useUIStore } from '@/stores/useUIStore';
import { useTradingStore } from '@/features/trading/stores/useTradingStore';
import { formatCurrency, formatPercentage, formatCompactCurrency } from '@/lib/formatters';
import { StatusIndicator } from '@/components/feedback/StatusIndicator';
import { Button } from '@/components/ui/button';
import {
  Activity,
  Menu,
  X,
  Maximize2,
  Minimize2,
  Wallet,
} from 'lucide-react';
import { cn } from '@/lib/utils';

export function Header() {
  const { getSelectedTicker, connectionStatus, latencyMs } = useMarketStore();
  const {
    isMobileMenuOpen,
    setMobileMenuOpen,
    isCompactDensity,
    toggleCompactDensity,
  } = useUIStore();
  const { getPortfolioStats, getAvailableUsdt, usdtReserved } = useTradingStore();

  const selectedTicker = getSelectedTicker();
  const isPositive = selectedTicker.priceChangePercent24h >= 0;
  const { totalEquity } = getPortfolioStats();
  const availableUsdt = getAvailableUsdt();

  return (
    <header className="flex h-14 w-full items-center justify-between border-b border-[#182030] bg-[#0b0e17] px-3 sm:px-4 text-slate-200">
      {/* Left: Brand & Mobile Trigger */}
      <div className="flex items-center gap-3">
        <button
          onClick={() => setMobileMenuOpen(!isMobileMenuOpen)}
          className="rounded p-1.5 text-slate-400 hover:bg-[#151b2a] hover:text-white md:hidden"
          aria-label="Toggle navigation menu"
        >
          {isMobileMenuOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
        </button>

        <div className="flex items-center gap-2">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-tr from-cyan-600 to-indigo-600 text-white shadow-md shadow-cyan-950">
            <Activity className="h-4 w-4 animate-pulse" />
          </div>
          <div>
            <div className="flex items-center gap-1.5">
              <span className="font-bold tracking-tight text-white text-sm">TradePulse</span>
              <span className="rounded bg-indigo-500/20 px-1 py-0.2 text-[9px] font-semibold text-indigo-300 border border-indigo-500/30">
                PRO
              </span>
            </div>
            <p className="text-[10px] text-slate-500 hidden sm:block">Crypto Trading Terminal</p>
          </div>
        </div>

        {/* Selected ticker stats pill */}
        <div className="hidden lg:flex items-center gap-4 ml-6 border-l border-[#1e273a] pl-4">
          <div>
            <div className="flex items-center gap-1.5">
              <span className="font-bold text-xs text-white">{selectedTicker.symbol}</span>
              <span className="text-[10px] text-slate-400">{selectedTicker.name}</span>
            </div>
            <div className="flex items-baseline gap-2">
              <span className="font-mono text-sm font-semibold text-slate-100 tabular-nums">
                {formatCurrency(selectedTicker.lastPrice)}
              </span>
              <span
                className={cn(
                  'font-mono text-xs font-medium tabular-nums',
                  isPositive ? 'text-emerald-400' : 'text-rose-400'
                )}
              >
                {formatPercentage(selectedTicker.priceChangePercent24h)}
              </span>
            </div>
          </div>

          <div className="flex items-center gap-4 text-[11px] text-slate-400 border-l border-[#182030] pl-4">
            <div>
              <span className="block text-[10px] text-slate-500">24h High</span>
              <span className="font-mono text-slate-200 tabular-nums">
                {formatCurrency(selectedTicker.high24h)}
              </span>
            </div>
            <div>
              <span className="block text-[10px] text-slate-500">24h Low</span>
              <span className="font-mono text-slate-200 tabular-nums">
                {formatCurrency(selectedTicker.low24h)}
              </span>
            </div>
            <div>
              <span className="block text-[10px] text-slate-500">24h Volume (USDT)</span>
              <span className="font-mono text-slate-200 tabular-nums">
                {formatCompactCurrency(selectedTicker.quoteVolume24h)}
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* Right: Controls & Virtual Balance */}
      <div className="flex items-center gap-2 sm:gap-3">
        {/* Connection status indicator */}
        <StatusIndicator status={connectionStatus} latencyMs={latencyMs} className="hidden sm:inline-flex" />

        {/* Simulated Wallet Balance Pill */}
        <div
          title={`Available: ${formatCurrency(availableUsdt)} | Reserved: ${formatCurrency(usdtReserved)}`}
          className="flex items-center gap-2 rounded-md border border-emerald-500/30 bg-emerald-950/20 px-2.5 py-1 text-xs select-none"
        >
          <Wallet className="h-3.5 w-3.5 text-emerald-400" />
          <div className="text-right">
            <span className="block text-[9px] uppercase tracking-wider text-emerald-400/80 font-medium leading-none">
              Paper Equity
            </span>
            <span className="font-mono font-semibold text-emerald-300 tabular-nums text-xs">
              {formatCurrency(totalEquity)}
            </span>
          </div>
        </div>

        {/* Density toggle */}
        <Button
          variant="outline"
          size="icon"
          onClick={toggleCompactDensity}
          title={isCompactDensity ? 'Switch to Standard Spacing' : 'Switch to Compact Density'}
          className="hidden sm:inline-flex"
        >
          {isCompactDensity ? (
            <Maximize2 className="h-3.5 w-3.5 text-slate-400" />
          ) : (
            <Minimize2 className="h-3.5 w-3.5 text-slate-400" />
          )}
        </Button>
      </div>
    </header>
  );
}
