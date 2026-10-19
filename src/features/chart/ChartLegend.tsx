import { CandleStick } from '@/types/market';
import { formatCurrency, formatPercentage, formatCompactNumber } from '@/lib/formatters';
import { cn } from '@/lib/utils';

interface ChartLegendProps {
  candle: CandleStick | null;
  latestCandle: CandleStick | null;
  liveTickerPrice?: number;
}

export function ChartLegend({ candle, latestCandle, liveTickerPrice }: ChartLegendProps) {
  const isHovered = Boolean(candle);
  const activeCandle = candle || latestCandle;

  if (!activeCandle) {
    return (
      <div className="flex items-center h-6 px-3 bg-[#0a0d15] text-[11px] font-mono text-slate-500 border-b border-[#151c2a]">
        <span>Hover chart to inspect historical OHLC values</span>
      </div>
    );
  }

  const { open, high, low, close, volume, time } = activeCandle;
  const changeValue = close - open;
  const changePercent = (changeValue / (open || 1)) * 100;
  const isPositive = close >= open;

  const candleDate = new Date(time * 1000);
  const formattedDate = candleDate.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
  });
  const formattedTime = candleDate.toLocaleTimeString('en-US', {
    hour12: false,
    hour: '2-digit',
    minute: '2-digit',
  });

  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 min-h-[26px] px-3 py-1 bg-[#090d16] text-[11px] font-mono border-b border-[#151c2a] select-none">
      {/* Historical vs Active Bar Badge */}
      <div className="flex items-center gap-1.5">
        <span
          className={cn(
            'px-1.5 py-0.2 rounded text-[9px] uppercase font-bold tracking-wider border',
            isHovered
              ? 'bg-indigo-500/15 text-indigo-300 border-indigo-500/30'
              : 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30'
          )}
        >
          {isHovered ? 'Historical' : 'Active Bar'}
        </span>
        <span className="text-slate-400">
          {formattedDate} {formattedTime}
        </span>
      </div>

      {/* OHLC Metrics */}
      <div className="flex items-center gap-2.5">
        <div>
          <span className="text-slate-500 mr-1">O</span>
          <span className="text-slate-200 tabular-nums">{formatCurrency(open)}</span>
        </div>
        <div>
          <span className="text-slate-500 mr-1">H</span>
          <span className="text-slate-200 tabular-nums">{formatCurrency(high)}</span>
        </div>
        <div>
          <span className="text-slate-500 mr-1">L</span>
          <span className="text-slate-200 tabular-nums">{formatCurrency(low)}</span>
        </div>
        <div>
          <span className="text-slate-500 mr-1">C</span>
          <span
            className={cn(
              'font-semibold tabular-nums',
              isPositive ? 'text-emerald-400' : 'text-rose-400'
            )}
          >
            {formatCurrency(close)}
          </span>
        </div>
      </div>

      {/* Change & Live Ticker Price */}
      <div className="flex items-center gap-3 ml-auto">
        <div
          className={cn(
            'flex items-center font-semibold tabular-nums',
            isPositive ? 'text-emerald-400' : 'text-rose-400'
          )}
        >
          <span>
            {changeValue >= 0 ? '+' : ''}
            {formatCurrency(changeValue)} ({formatPercentage(changePercent)})
          </span>
        </div>

        <div className="hidden sm:flex items-center">
          <span className="text-slate-500 mr-1">Vol</span>
          <span className="text-slate-300 tabular-nums">{formatCompactNumber(volume)}</span>
        </div>

        {liveTickerPrice && liveTickerPrice > 0 && (
          <div className="hidden md:flex items-center gap-1 border-l border-[#1a2336] pl-2.5">
            <span className="text-slate-500 text-[10px]">Live Ticker:</span>
            <span className="text-cyan-300 font-bold tabular-nums">
              {formatCurrency(liveTickerPrice)}
            </span>
          </div>
        )}
      </div>
    </div>
  );
}
