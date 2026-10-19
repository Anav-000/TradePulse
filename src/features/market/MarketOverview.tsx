import { useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useMarketStore } from '@/stores/useMarketStore';
import { useUIStore } from '@/stores/useUIStore';
import {
  fetchGlobalMarketOverview,
  fetch7DaySparklines,
} from '@/services/api/globalMarketApi';
import { SUPPORTED_SYMBOLS } from '@/services/websocket/BinanceWebSocketManager';
import { classifyAndRankMarketTickers } from './marketRankings';
import {
  formatCurrency,
  formatPercentage,
  formatCompactCurrency,
} from '@/lib/formatters';
import { cn } from '@/lib/utils';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  TrendingUp,
  TrendingDown,
  Search,
  Star,
  Activity,
  BarChart3,
  DollarSign,
  PieChart,
  ArrowRight,
  RefreshCw,
} from 'lucide-react';

export function MarketOverview() {
  const {
    tickers,
    overview,
    globalStatsSource,
    globalStatsStatus,
    globalStatsLastUpdated,
    setGlobalOverview,
    updateSparklines,
    searchQuery,
    setSearchQuery,
    categoryFilter,
    setCategoryFilter,
    toggleFavorite,
    setSelectedSymbol,
  } = useMarketStore();
  const { setActiveView } = useUIStore();

  // 1. Fetch real global crypto market overview from CoinPaprika & Alternative.me
  const {
    data: globalData,
    refetch: refetchGlobal,
    isFetching: isGlobalFetching,
  } = useQuery({
    queryKey: ['globalMarketOverview'],
    queryFn: ({ signal }) => fetchGlobalMarketOverview(signal),
    staleTime: 1000 * 60, // 1 min
    refetchInterval: 1000 * 60 * 2, // 2 mins
    refetchOnWindowFocus: false,
  });

  useEffect(() => {
    if (globalData) {
      setGlobalOverview(globalData.stats, globalData.source, globalData.status);
    }
  }, [globalData, setGlobalOverview]);

  // 2. Fetch authentic 7-day daily sparkline klines from Binance public API
  const { data: sparklineData } = useQuery({
    queryKey: ['marketSparklines7d'],
    queryFn: ({ signal }) => fetch7DaySparklines(SUPPORTED_SYMBOLS, signal),
    staleTime: 1000 * 60 * 5, // 5 mins
    refetchInterval: 1000 * 60 * 10, // 10 mins
    refetchOnWindowFocus: false,
  });

  useEffect(() => {
    if (sparklineData && Object.keys(sparklineData).length > 0) {
      updateSparklines(sparklineData);
    }
  }, [sparklineData, updateSparklines]);

  // Filter tickers based on search and category
  const filteredTickers = tickers.filter((ticker) => {
    const matchesSearch =
      ticker.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      ticker.symbol.toLowerCase().includes(searchQuery.toLowerCase()) ||
      ticker.baseAsset.toLowerCase().includes(searchQuery.toLowerCase());

    if (!matchesSearch) return false;

    if (categoryFilter === 'gainers') return ticker.priceChangePercent24h > 0;
    if (categoryFilter === 'losers') return ticker.priceChangePercent24h < 0;
    if (categoryFilter === 'favorites') return !!ticker.isFavorite;

    return true;
  });

  const { topPerformers, bottomPerformers } = classifyAndRankMarketTickers(tickers, 3);

  const handleTradeClick = (symbol: string) => {
    setSelectedSymbol(symbol);
    setActiveView('terminal');
  };

  return (
    <div className="space-y-4 p-4 lg:p-6">
      {/* Top Banner */}
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-xl font-bold text-white tracking-tight flex items-center gap-2">
            <span>Market Overview</span>
            <span
              className={cn(
                'inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[10px] font-mono font-medium border',
                globalStatsStatus === 'live'
                  ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30'
                  : 'bg-amber-500/10 text-amber-400 border-amber-500/30'
              )}
            >
              <span
                className={cn(
                  'h-1.5 w-1.5 rounded-full',
                  globalStatsStatus === 'live' ? 'bg-emerald-400 animate-pulse' : 'bg-amber-400'
                )}
              />
              {globalStatsStatus === 'live' ? 'Live Public Feeds' : 'Cached Baseline'}
            </span>
          </h1>
          <p className="text-xs text-slate-400 mt-0.5">
            Real-time cryptocurrency metrics, market cap distributions, and 24h volume leaders.
          </p>
        </div>

        <div className="flex items-center gap-2 text-[11px] text-slate-400 font-mono">
          <span className="hidden md:inline text-slate-500">
            Source: {globalStatsSource}
          </span>
          {globalStatsLastUpdated && (
            <span className="text-slate-500 hidden lg:inline">
              ({new Date(globalStatsLastUpdated).toLocaleTimeString()})
            </span>
          )}
          <Button
            variant="outline"
            size="sm"
            onClick={() => refetchGlobal()}
            disabled={isGlobalFetching}
            className="h-7 text-xs border-[#1e273a] text-slate-300 hover:bg-[#151c2a]"
          >
            <RefreshCw
              className={cn('mr-1.5 h-3 w-3 text-cyan-400', isGlobalFetching && 'animate-spin')}
            />
            Sync
          </Button>
        </div>
      </div>

      {/* Global Market Stats Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {/* Total Market Cap */}
        <Card className="border-[#1e273a] bg-[#0c101a]">
          <CardContent className="p-3.5">
            <div className="flex items-center justify-between text-slate-400 text-xs mb-1">
              <span>Crypto Market Cap</span>
              <DollarSign className="h-4 w-4 text-cyan-400" />
            </div>
            <div className="text-lg font-bold font-mono text-white tabular-nums">
              {formatCompactCurrency(overview.totalMarketCap)}
            </div>
            <div className="flex items-center gap-1 text-[11px] font-mono mt-1 text-emerald-400">
              <TrendingUp className="h-3 w-3" />
              <span>{formatPercentage(overview.marketCapChange24h)} 24h</span>
            </div>
          </CardContent>
        </Card>

        {/* 24h Volume */}
        <Card className="border-[#1e273a] bg-[#0c101a]">
          <CardContent className="p-3.5">
            <div className="flex items-center justify-between text-slate-400 text-xs mb-1">
              <span>24h Total Volume</span>
              <Activity className="h-4 w-4 text-indigo-400" />
            </div>
            <div className="text-lg font-bold font-mono text-white tabular-nums">
              {formatCompactCurrency(overview.totalVolume24h)}
            </div>
            <div className="text-[11px] text-slate-500 mt-1">Across 1,280+ trading pairs</div>
          </CardContent>
        </Card>

        {/* BTC & ETH Dominance */}
        <Card className="border-[#1e273a] bg-[#0c101a]">
          <CardContent className="p-3.5">
            <div className="flex items-center justify-between text-slate-400 text-xs mb-1">
              <span>Dominance</span>
              <PieChart className="h-4 w-4 text-amber-400" />
            </div>
            <div className="flex items-baseline gap-2 font-mono">
              <span className="text-lg font-bold text-white">{overview.btcDominance}%</span>
              <span className="text-xs text-slate-400">BTC</span>
              <span className="text-xs text-slate-500">|</span>
              <span className="text-sm font-semibold text-slate-300">{overview.ethDominance}%</span>
              <span className="text-xs text-slate-400">ETH</span>
            </div>
            <div className="w-full bg-[#182030] h-1.5 rounded-full mt-2 overflow-hidden flex">
              <div
                className="bg-amber-500 h-full"
                style={{ width: `${overview.btcDominance}%` }}
              />
              <div
                className="bg-indigo-500 h-full"
                style={{ width: `${overview.ethDominance}%` }}
              />
            </div>
          </CardContent>
        </Card>

        {/* Fear & Greed Index */}
        <Card className="border-[#1e273a] bg-[#0c101a]">
          <CardContent className="p-3.5">
            <div className="flex items-center justify-between text-slate-400 text-xs mb-1">
              <span>Fear & Greed Index</span>
              <BarChart3 className="h-4 w-4 text-emerald-400" />
            </div>
            <div className="flex items-baseline gap-2">
              <span className="text-lg font-bold font-mono text-emerald-400">
                {overview.fearAndGreedIndex}
              </span>
              <span className="text-xs font-semibold text-emerald-300">
                {overview.fearAndGreedSentiment}
              </span>
            </div>
            <div className="text-[11px] text-slate-500 mt-1">Sentiment updated daily</div>
          </CardContent>
        </Card>
      </div>

      {/* Top & Bottom 24h Performers Quick Bar */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {/* Top Performers */}
        <Card className="border-[#1e273a] bg-[#0f1420]">
          <CardHeader className="py-2.5 px-3.5 border-b border-[#182030]">
            <CardTitle className="text-emerald-400 flex items-center justify-between">
              <span className="flex items-center gap-1.5 text-xs font-semibold">
                <TrendingUp className="h-4 w-4" /> Top 24h Performers
              </span>
              <span className="text-[10px] text-slate-500 font-normal font-mono">
                Supported Pairs
              </span>
            </CardTitle>
          </CardHeader>
          <CardContent className="p-3 space-y-2">
            {topPerformers.length === 0 ? (
              <p className="text-xs text-slate-500 py-3 text-center">
                No active market tickers available.
              </p>
            ) : (
              topPerformers.map((g) => {
                const isItemPositive = g.priceChangePercent24h >= 0;
                return (
                  <div
                    key={g.symbol}
                    onClick={() => handleTradeClick(g.symbol)}
                    className="flex items-center justify-between p-2 rounded hover:bg-[#151b2a] cursor-pointer transition-colors"
                  >
                    <div className="flex items-center gap-2">
                      <span className="font-semibold text-xs text-white">{g.baseAsset}</span>
                      <span className="text-[11px] text-slate-400">{g.name}</span>
                    </div>
                    <div className="text-right">
                      <div className="font-mono text-xs text-white">{formatCurrency(g.lastPrice)}</div>
                      <div
                        className={cn(
                          'font-mono text-[11px] font-medium',
                          isItemPositive ? 'text-emerald-400' : 'text-rose-400'
                        )}
                      >
                        {isItemPositive ? '+' : ''}
                        {formatPercentage(g.priceChangePercent24h)}
                      </div>
                    </div>
                  </div>
                );
              })
            )}
          </CardContent>
        </Card>

        {/* Bottom Performers */}
        <Card className="border-[#1e273a] bg-[#0f1420]">
          <CardHeader className="py-2.5 px-3.5 border-b border-[#182030]">
            <CardTitle className="text-rose-400 flex items-center justify-between">
              <span className="flex items-center gap-1.5 text-xs font-semibold">
                <TrendingDown className="h-4 w-4" /> Bottom 24h Performers
              </span>
              <span className="text-[10px] text-slate-500 font-normal font-mono">
                Supported Pairs
              </span>
            </CardTitle>
          </CardHeader>
          <CardContent className="p-3 space-y-2">
            {bottomPerformers.length === 0 ? (
              <p className="text-xs text-slate-500 py-3 text-center">
                No active market tickers available.
              </p>
            ) : (
              bottomPerformers.map((l) => {
                const isItemPositive = l.priceChangePercent24h >= 0;
                return (
                  <div
                    key={l.symbol}
                    onClick={() => handleTradeClick(l.symbol)}
                    className="flex items-center justify-between p-2 rounded hover:bg-[#151b2a] cursor-pointer transition-colors"
                  >
                    <div className="flex items-center gap-2">
                      <span className="font-semibold text-xs text-white">{l.baseAsset}</span>
                      <span className="text-[11px] text-slate-400">{l.name}</span>
                    </div>
                    <div className="text-right">
                      <div className="font-mono text-xs text-white">{formatCurrency(l.lastPrice)}</div>
                      <div
                        className={cn(
                          'font-mono text-[11px] font-medium',
                          isItemPositive ? 'text-emerald-400' : 'text-rose-400'
                        )}
                      >
                        {isItemPositive ? '+' : ''}
                        {formatPercentage(l.priceChangePercent24h)}
                      </div>
                    </div>
                  </div>
                );
              })
            )}
          </CardContent>
        </Card>
      </div>

      {/* Main Markets Table */}
      <Card className="border-[#1e273a] bg-[#0f1420]">
        <CardHeader className="p-3.5 flex-row items-center justify-between gap-4 flex-wrap">
          <div className="flex items-center gap-2 flex-wrap">
            <CardTitle>All Crypto Assets</CardTitle>
            <div className="flex items-center gap-1 rounded-md bg-[#0a0d15] p-0.5 border border-[#1e273a]">
              {(['all', 'gainers', 'losers', 'favorites'] as const).map((filter) => (
                <button
                  key={filter}
                  onClick={() => setCategoryFilter(filter)}
                  className={cn(
                    'rounded px-2.5 py-1 text-[11px] font-medium capitalize transition-colors',
                    categoryFilter === filter
                      ? 'bg-[#1e273a] text-cyan-400'
                      : 'text-slate-400 hover:text-white'
                  )}
                >
                  {filter}
                </button>
              ))}
            </div>
          </div>

          <div className="relative w-full sm:w-64">
            <Search className="absolute left-2.5 top-2 h-4 w-4 text-slate-500" />
            <Input
              placeholder="Search coin or pair (e.g. BTC)..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-8 h-8 text-xs bg-[#090c13]"
            />
          </div>
        </CardHeader>

        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="border-b border-[#182030] bg-[#0a0d15] text-[10px] uppercase tracking-wider text-slate-500">
                <tr>
                  <th className="py-2.5 pl-4 pr-2 w-8"></th>
                  <th className="py-2.5 px-3">Asset</th>
                  <th className="py-2.5 px-3 text-right">Price</th>
                  <th className="py-2.5 px-3 text-right">24h Change</th>
                  <th className="py-2.5 px-3 text-right hidden sm:table-cell">24h High</th>
                  <th className="py-2.5 px-3 text-right hidden sm:table-cell">24h Low</th>
                  <th className="py-2.5 px-3 text-right hidden md:table-cell">24h Volume</th>
                  <th className="py-2.5 px-3 text-center hidden lg:table-cell w-32">Trend (7d)</th>
                  <th className="py-2.5 pr-4 pl-2 text-right">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#182030]">
                {filteredTickers.length === 0 ? (
                  <tr>
                    <td colSpan={9} className="py-8 text-center text-slate-500">
                      {categoryFilter === 'gainers'
                        ? 'No assets with positive 24h gains recorded among supported pairs.'
                        : categoryFilter === 'losers'
                        ? 'No assets with negative 24h declines recorded among supported pairs.'
                        : categoryFilter === 'favorites'
                        ? 'No favorited assets found. Click the star icon next to any coin to add favorites.'
                        : `No assets found matching "${searchQuery}".`}
                    </td>
                  </tr>
                ) : (
                  filteredTickers.map((ticker) => {
                    const isPositive = ticker.priceChangePercent24h >= 0;

                    // Compute authentic SVG sparkline path
                    const hasSparkline = ticker.sparkline7d && ticker.sparkline7d.length >= 2;
                    const firstPrice = hasSparkline ? ticker.sparkline7d[0] : 0;
                    const lastPrice = hasSparkline ? ticker.sparkline7d[ticker.sparkline7d.length - 1] : 0;
                    const change7d = hasSparkline && firstPrice > 0 ? ((lastPrice - firstPrice) / firstPrice) * 100 : 0;
                    const is7dPositive = change7d >= 0;

                    const min = hasSparkline ? Math.min(...ticker.sparkline7d) : 0;
                    const max = hasSparkline ? Math.max(...ticker.sparkline7d) : 0;
                    const range = max - min || 1;
                    const points = hasSparkline
                      ? ticker.sparkline7d
                          .map((val, idx) => {
                            const x = (idx / (ticker.sparkline7d.length - 1)) * 100;
                            const y = 22 - ((val - min) / range) * 18;
                            return `${x.toFixed(1)},${y.toFixed(1)}`;
                          })
                          .join(' ')
                      : '';

                    return (
                      <tr
                        key={ticker.symbol}
                        className="hover:bg-[#141a29] transition-colors group cursor-pointer"
                        onClick={() => handleTradeClick(ticker.symbol)}
                      >
                        {/* Favorite star */}
                        <td
                          className="py-3 pl-4 pr-2"
                          onClick={(e) => {
                            e.stopPropagation();
                            toggleFavorite(ticker.symbol);
                          }}
                        >
                          <Star
                            className={cn(
                              'h-3.5 w-3.5 transition-colors',
                              ticker.isFavorite
                                ? 'fill-amber-400 text-amber-400'
                                : 'text-slate-600 hover:text-slate-400'
                            )}
                          />
                        </td>

                        {/* Asset name & icon */}
                        <td className="py-3 px-3">
                          <div className="flex items-center gap-2">
                            <div className="flex h-6 w-6 items-center justify-center rounded-full bg-[#1b2336] text-[10px] font-bold text-slate-200">
                              {ticker.baseAsset.slice(0, 3)}
                            </div>
                            <div>
                              <span className="font-semibold text-white block">
                                {ticker.baseAsset}
                              </span>
                              <span className="text-[10px] text-slate-500">
                                {ticker.name} / {ticker.quoteAsset}
                              </span>
                            </div>
                          </div>
                        </td>

                        {/* Last price */}
                        <td className="py-3 px-3 text-right font-mono font-medium text-white tabular-nums">
                          {formatCurrency(ticker.lastPrice)}
                        </td>

                        {/* 24h change */}
                        <td className="py-3 px-3 text-right font-mono tabular-nums">
                          <span
                            className={cn(
                              'inline-block px-1.5 py-0.5 rounded text-[11px] font-medium',
                              isPositive
                                ? 'bg-emerald-500/10 text-emerald-400'
                                : 'bg-rose-500/10 text-rose-400'
                            )}
                          >
                            {formatPercentage(ticker.priceChangePercent24h)}
                          </span>
                        </td>

                        {/* 24h high */}
                        <td className="py-3 px-3 text-right font-mono text-slate-300 tabular-nums hidden sm:table-cell">
                          {formatCurrency(ticker.high24h)}
                        </td>

                        {/* 24h low */}
                        <td className="py-3 px-3 text-right font-mono text-slate-400 tabular-nums hidden sm:table-cell">
                          {formatCurrency(ticker.low24h)}
                        </td>

                        {/* 24h volume */}
                        <td className="py-3 px-3 text-right font-mono text-slate-300 tabular-nums hidden md:table-cell">
                          {formatCompactCurrency(ticker.quoteVolume24h)}
                        </td>

                        {/* Sparkline (7d Authentic Trend) */}
                        <td className="py-2.5 px-3 text-center hidden lg:table-cell">
                          {hasSparkline ? (
                            <div className="flex flex-col items-center">
                              <svg className="w-24 h-5 mx-auto overflow-visible" viewBox="0 0 100 24">
                                <polyline
                                  fill="none"
                                  stroke={is7dPositive ? '#10b981' : '#f43f5e'}
                                  strokeWidth="1.75"
                                  strokeLinecap="round"
                                  strokeLinejoin="round"
                                  points={points}
                                />
                              </svg>
                              <span
                                className={cn(
                                  'text-[9px] font-mono font-medium mt-0.5',
                                  is7dPositive ? 'text-emerald-400' : 'text-rose-400'
                                )}
                              >
                                {change7d >= 0 ? '+' : ''}
                                {change7d.toFixed(1)}% 7d
                              </span>
                            </div>
                          ) : (
                            <span className="text-[10px] text-slate-600 font-mono">—</span>
                          )}
                        </td>

                        {/* Action */}
                        <td className="py-3 pr-4 pl-2 text-right">
                          <Button
                            variant="secondary"
                            size="sm"
                            onClick={(e) => {
                              e.stopPropagation();
                              handleTradeClick(ticker.symbol);
                            }}
                            className="group-hover:bg-cyan-600 group-hover:text-white transition-colors"
                          >
                            <span>Trade</span>
                            <ArrowRight className="ml-1 h-3 w-3" />
                          </Button>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
