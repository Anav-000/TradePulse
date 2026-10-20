import { useState, useRef, useEffect } from 'react';
import { useMarketStore } from '@/stores/useMarketStore';
import { useHistoricalCandles } from './hooks/useHistoricalCandles';
import { TradingViewChart, TradingViewChartHandle } from './TradingViewChart';
import { ChartToolbar } from './ChartToolbar';
import { ChartLegend } from './ChartLegend';
import { CandleStick } from '@/types/market';
import { Button } from '@/components/ui/button';
import { AlertCircle, RefreshCw, BarChart2 } from 'lucide-react';

export function ChartContainer() {
  const { selectedSymbol, timeFrame, setTimeFrame, tickers } = useMarketStore();
  const selectedTicker = tickers.find((t) => t.symbol === selectedSymbol);
  const livePrice = selectedTicker?.lastPrice;

  const { data, isLoading, isError, error, refetch, isFetching } = useHistoricalCandles(
    selectedSymbol,
    timeFrame
  );

  const chartHandleRef = useRef<TradingViewChartHandle | null>(null);
  const [hoveredCandle, setHoveredCandle] = useState<CandleStick | null>(null);
  const [liveCandle, setLiveCandle] = useState<CandleStick | null>(null);

  // Reset live candle whenever symbol or timeframe changes
  useEffect(() => {
    setLiveCandle(null);
  }, [selectedSymbol, timeFrame]);

  const candles = data?.candles || [];
  const latestHistoricalCandle = candles.length > 0 ? candles[candles.length - 1] : null;
  const activeLatestCandle = liveCandle || latestHistoricalCandle;

  // Synchronize ticker price with verified candle close if unaligned
  useEffect(() => {
    if (latestHistoricalCandle && latestHistoricalCandle.close > 0) {
      useMarketStore.getState().syncTickerPrice(selectedSymbol, latestHistoricalCandle.close, {
        candleTimestamp: latestHistoricalCandle.time * 1000,
        fetchTime: data?.lastUpdated,
      });
    }
  }, [selectedSymbol, latestHistoricalCandle?.close, latestHistoricalCandle?.time, data?.lastUpdated]);

  const handleFitContent = () => {
    chartHandleRef.current?.fitContent();
  };

  return (
    <div className="flex-1 rounded-lg border border-[#1e273a] bg-[#0c101a] flex flex-col min-h-[420px] overflow-hidden">
      {/* Chart Top Toolbar */}
      <ChartToolbar
        symbol={selectedSymbol}
        timeFrame={timeFrame}
        onTimeFrameChange={setTimeFrame}
        dataSource={data?.source}
        lastUpdated={data?.lastUpdated}
        isFetching={isFetching}
        onRefresh={() => refetch()}
        onFitContent={handleFitContent}
      />

      {/* Interactive OHLC Legend Bar */}
      <ChartLegend
        candle={hoveredCandle}
        latestCandle={activeLatestCandle}
        liveTickerPrice={livePrice}
      />

      {/* Main Chart Body / Feedback States */}
      <div className="relative flex-1 flex flex-col w-full h-full min-h-[350px] bg-[#0c101a]">
        {/* Loading Skeleton */}
        {isLoading && (
          <div className="absolute inset-0 z-20 flex flex-col items-center justify-center bg-[#0c101a]/90 backdrop-blur-sm space-y-3">
            <div className="flex items-center gap-2 text-cyan-400">
              <RefreshCw className="h-6 w-6 animate-spin" />
              <span className="font-semibold text-sm text-white">Loading Historical Data</span>
            </div>
            <p className="text-xs text-slate-400 max-w-xs text-center">
              Fetching verified {timeFrame} OHLC klines for {selectedSymbol} from public exchange API...
            </p>
          </div>
        )}

        {/* Error State */}
        {isError && !isLoading && (
          <div className="absolute inset-0 z-20 flex flex-col items-center justify-center bg-[#0c101a] p-6 text-center space-y-3">
            <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-rose-500/10 border border-rose-500/20 text-rose-400">
              <AlertCircle className="h-6 w-6" />
            </div>
            <div>
              <h4 className="text-sm font-semibold text-white">Market Data Unavailable</h4>
              <p className="text-xs text-slate-400 max-w-md mt-1">
                {error?.message || 'Could not retrieve candles from exchange API.'}
              </p>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={() => refetch()}
              className="mt-2 text-xs border-[#2c3852] text-slate-200 hover:bg-[#151c2a]"
            >
              <RefreshCw className="mr-1.5 h-3.5 w-3.5 text-cyan-400" />
              Retry Connection
            </Button>
          </div>
        )}

        {/* Empty State */}
        {!isLoading && !isError && candles.length === 0 && (
          <div className="absolute inset-0 z-20 flex flex-col items-center justify-center bg-[#0c101a] p-6 text-center space-y-2 text-slate-500">
            <BarChart2 className="h-8 w-8 text-slate-600 mb-1" />
            <h4 className="text-xs font-semibold text-slate-300">No Candlestick Data</h4>
            <p className="text-[11px] text-slate-500 max-w-sm">
              No historical candles found for {selectedSymbol} on {timeFrame} interval.
            </p>
            <Button variant="secondary" size="sm" onClick={() => refetch()}>
              Try Refreshing
            </Button>
          </div>
        )}

        {/* Real Candlestick Chart */}
        {!isError && (
          <TradingViewChart
            ref={chartHandleRef}
            candles={candles}
            symbol={selectedSymbol}
            timeFrame={timeFrame}
            livePrice={livePrice}
            onCrosshairMove={setHoveredCandle}
            onLiveCandleUpdate={setLiveCandle}
            className="flex-1 w-full h-full min-h-[350px]"
          />
        )}
      </div>
    </div>
  );
}
