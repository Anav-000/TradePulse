import { TimeFrame } from '@/types/market';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import {
  RefreshCw,
  Maximize2,
  Database,
  Radio,
} from 'lucide-react';

interface ChartToolbarProps {
  symbol: string;
  timeFrame: TimeFrame;
  onTimeFrameChange: (tf: TimeFrame) => void;
  dataSource?: string;
  lastUpdated?: number;
  isFetching: boolean;
  onRefresh: () => void;
  onFitContent: () => void;
}

const TIMEFRAMES: TimeFrame[] = ['1m', '5m', '15m', '1h', '4h', '1D'];

export function ChartToolbar({
  symbol,
  timeFrame,
  onTimeFrameChange,
  dataSource = 'Binance Public API',
  lastUpdated,
  isFetching,
  onRefresh,
  onFitContent,
}: ChartToolbarProps) {
  const formattedTime = lastUpdated
    ? new Date(lastUpdated).toLocaleTimeString('en-US', {
        hour12: false,
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
      })
    : null;

  return (
    <div className="flex flex-wrap items-center justify-between border-b border-[#182030] bg-[#090d16] px-3 py-2 gap-2 text-xs select-none">
      {/* Left: Symbol & Timeframe Buttons */}
      <div className="flex items-center gap-2.5 flex-wrap">
        <div className="flex items-center gap-1.5">
          <span className="font-bold text-white tracking-tight">{symbol}</span>
          <Badge variant="accent" className="text-[9px] px-1.5 py-0">
            Spot
          </Badge>
        </div>

        <div className="h-4 w-[1px] bg-[#1e273a] hidden sm:block" />

        {/* Timeframe pill selector */}
        <div className="flex items-center rounded-md bg-[#06080e] p-0.5 border border-[#182030]">
          {TIMEFRAMES.map((tf) => {
            const isSelected = timeFrame === tf;
            return (
              <button
                key={tf}
                onClick={() => onTimeFrameChange(tf)}
                disabled={isFetching && isSelected}
                className={cn(
                  'px-2 py-0.5 rounded text-[11px] font-medium transition-all',
                  isSelected
                    ? 'bg-[#182235] text-cyan-400 shadow-sm font-semibold'
                    : 'text-slate-400 hover:text-slate-200'
                )}
              >
                {tf}
              </button>
            );
          })}
        </div>
      </div>

      {/* Right: Source, Last Updated & Tools */}
      <div className="flex items-center gap-2 sm:gap-3 flex-wrap">
        {/* Source badge */}
        <div className="hidden md:flex items-center gap-1.5 rounded-full bg-[#111726] border border-[#1e273a] px-2 py-0.5 text-[10px] text-slate-400">
          <Database className="h-2.5 w-2.5 text-cyan-400" />
          <span>{dataSource}</span>
          <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse-subtle" />
        </div>

        {/* Timestamp */}
        {formattedTime && (
          <div className="hidden lg:flex items-center gap-1 text-[10px] text-slate-500 font-mono">
            <Radio className="h-2.5 w-2.5 text-slate-500" />
            <span>Updated {formattedTime}</span>
          </div>
        )}

        {/* Fit Content Action */}
        <Button
          variant="ghost"
          size="icon"
          onClick={onFitContent}
          title="Fit Chart to Content (Reset Scale)"
          className="h-7 w-7 text-slate-400 hover:text-white"
        >
          <Maximize2 className="h-3.5 w-3.5" />
        </Button>

        {/* Refresh Action */}
        <Button
          variant="ghost"
          size="icon"
          onClick={onRefresh}
          title="Refresh Historical Candles"
          className="h-7 w-7 text-slate-400 hover:text-white"
        >
          <RefreshCw
            className={cn('h-3.5 w-3.5', isFetching && 'animate-spin text-cyan-400')}
          />
        </Button>
      </div>
    </div>
  );
}
