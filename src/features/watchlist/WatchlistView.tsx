import { useMarketStore } from '@/stores/useMarketStore';
import { useUIStore } from '@/stores/useUIStore';
import { formatCurrency, formatPercentage, formatCompactCurrency } from '@/lib/formatters';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Star, Search, ArrowRight, TrendingUp, TrendingDown } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useState } from 'react';

export function WatchlistView() {
  const { tickers, toggleFavorite, setSelectedSymbol } = useMarketStore();
  const { setActiveView } = useUIStore();
  const [filter, setFilter] = useState<'all' | 'favorites'>('favorites');
  const [search, setSearch] = useState('');

  const displayedTickers = tickers.filter((t) => {
    const matchesSearch =
      t.name.toLowerCase().includes(search.toLowerCase()) ||
      t.symbol.toLowerCase().includes(search.toLowerCase());
    if (!matchesSearch) return false;
    if (filter === 'favorites') return !!t.isFavorite;
    return true;
  });

  const handleTrade = (symbol: string) => {
    setSelectedSymbol(symbol);
    setActiveView('terminal');
  };

  return (
    <div className="space-y-4 p-4 lg:p-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
        <div>
          <h1 className="text-xl font-bold text-white tracking-tight flex items-center gap-2">
            <span>Watchlist</span>
            <Badge variant="accent">
              {tickers.filter((t) => t.isFavorite).length} Starred
            </Badge>
          </h1>
          <p className="text-xs text-slate-400">
            Pin and monitor your core trading pairs with customizable metrics and one-click execution.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <div className="flex rounded-md bg-[#0a0d15] p-0.5 border border-[#1e273a]">
            <button
              onClick={() => setFilter('favorites')}
              className={cn(
                'rounded px-3 py-1 text-xs font-medium transition-colors',
                filter === 'favorites' ? 'bg-[#1e273a] text-cyan-400' : 'text-slate-400 hover:text-white'
              )}
            >
              Starred Only
            </button>
            <button
              onClick={() => setFilter('all')}
              className={cn(
                'rounded px-3 py-1 text-xs font-medium transition-colors',
                filter === 'all' ? 'bg-[#1e273a] text-cyan-400' : 'text-slate-400 hover:text-white'
              )}
            >
              All Assets
            </button>
          </div>
        </div>
      </div>

      {/* Search Input */}
      <div className="relative max-w-sm">
        <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-slate-500" />
        <Input
          placeholder="Filter watchlist..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="pl-8 h-8 text-xs bg-[#0c101a]"
        />
      </div>

      {/* Watchlist Cards Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
        {displayedTickers.map((ticker) => {
          const isPositive = ticker.priceChangePercent24h >= 0;
          const rangePercent =
            ((ticker.lastPrice - ticker.low24h) / (ticker.high24h - ticker.low24h || 1)) * 100;

          return (
            <Card
              key={ticker.symbol}
              className="border-[#1e273a] bg-[#0c101a] hover:border-cyan-500/40 transition-all group"
            >
              <CardContent className="p-4 space-y-3">
                <div className="flex items-start justify-between">
                  <div className="flex items-center gap-2.5">
                    <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-[#161e2e] text-xs font-bold text-white border border-[#232c3f]">
                      {ticker.baseAsset}
                    </div>
                    <div>
                      <div className="flex items-center gap-1.5">
                        <span className="font-bold text-white text-sm">{ticker.symbol}</span>
                      </div>
                      <span className="text-[11px] text-slate-400">{ticker.name}</span>
                    </div>
                  </div>

                  <button
                    onClick={() => toggleFavorite(ticker.symbol)}
                    className="p-1 rounded hover:bg-[#1a2334] text-slate-500 transition-colors"
                  >
                    <Star
                      className={cn(
                        'h-4 w-4',
                        ticker.isFavorite
                          ? 'fill-amber-400 text-amber-400'
                          : 'text-slate-600 hover:text-slate-400'
                      )}
                    />
                  </button>
                </div>

                <div className="flex items-baseline justify-between pt-1">
                  <div>
                    <span className="text-lg font-bold font-mono text-white tabular-nums">
                      {formatCurrency(ticker.lastPrice)}
                    </span>
                  </div>
                  <div
                    className={cn(
                      'flex items-center font-mono text-xs font-semibold tabular-nums px-2 py-0.5 rounded',
                      isPositive
                        ? 'bg-emerald-500/10 text-emerald-400'
                        : 'bg-rose-500/10 text-rose-400'
                    )}
                  >
                    {isPositive ? (
                      <TrendingUp className="mr-1 h-3 w-3" />
                    ) : (
                      <TrendingDown className="mr-1 h-3 w-3" />
                    )}
                    {formatPercentage(ticker.priceChangePercent24h)}
                  </div>
                </div>

                {/* 24h High/Low range bar */}
                <div className="space-y-1 pt-1 border-t border-[#182030]">
                  <div className="flex justify-between text-[10px] text-slate-500 font-mono">
                    <span>L: {formatCurrency(ticker.low24h)}</span>
                    <span>H: {formatCurrency(ticker.high24h)}</span>
                  </div>
                  <div className="h-1.5 w-full bg-[#182030] rounded-full overflow-hidden">
                    <div
                      className="h-full bg-cyan-500 rounded-full"
                      style={{ width: `${Math.min(100, Math.max(0, rangePercent))}%` }}
                    />
                  </div>
                </div>

                {/* Card footer CTA */}
                <div className="pt-2 flex items-center justify-between">
                  <span className="text-[10px] text-slate-500 font-mono">
                    Vol {formatCompactCurrency(ticker.quoteVolume24h)}
                  </span>
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => handleTrade(ticker.symbol)}
                    className="group-hover:bg-cyan-600 group-hover:text-white transition-colors"
                  >
                    Trade
                    <ArrowRight className="ml-1 h-3 w-3" />
                  </Button>
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
