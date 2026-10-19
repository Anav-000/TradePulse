import { useMarketStore } from '@/stores/useMarketStore';
import { formatCurrency, formatPercentage } from '@/lib/formatters';
import { cn } from '@/lib/utils';
import { TrendingUp, TrendingDown } from 'lucide-react';

export function TickerTape() {
  const { tickers, selectedSymbol, setSelectedSymbol } = useMarketStore();

  return (
    <div className="flex h-9 w-full items-center border-b border-[#182030] bg-[#0a0d15] px-3 overflow-x-auto no-scrollbar select-none">
      <div className="flex items-center gap-4 shrink-0">
        <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-500 shrink-0">
          MARKETS
        </span>
        <div className="h-3 w-[1px] bg-[#1e273a]" />
        {tickers.map((ticker) => {
          const isPositive = ticker.priceChangePercent24h >= 0;
          const isSelected = ticker.symbol === selectedSymbol;

          return (
            <button
              key={ticker.symbol}
              onClick={() => setSelectedSymbol(ticker.symbol)}
              className={cn(
                'flex items-center gap-2 rounded px-2 py-1 text-xs transition-colors shrink-0',
                isSelected
                  ? 'bg-[#182030] text-white ring-1 ring-cyan-500/40'
                  : 'text-slate-300 hover:bg-[#121824] hover:text-white'
              )}
            >
              <span className="font-semibold">{ticker.baseAsset}</span>
              <span className="font-mono text-[11px] text-slate-200 tabular-nums">
                {formatCurrency(ticker.lastPrice)}
              </span>
              <span
                className={cn(
                  'flex items-center font-mono text-[10px] font-medium tabular-nums',
                  isPositive ? 'text-emerald-400' : 'text-rose-400'
                )}
              >
                {isPositive ? (
                  <TrendingUp className="mr-0.5 h-2.5 w-2.5" />
                ) : (
                  <TrendingDown className="mr-0.5 h-2.5 w-2.5" />
                )}
                {formatPercentage(ticker.priceChangePercent24h)}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
