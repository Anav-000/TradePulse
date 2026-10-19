import { useEffect, useRef, useImperativeHandle, forwardRef } from 'react';
import {
  createChart,
  IChartApi,
  ISeriesApi,
  IPriceLine,
  LineStyle,
  CandlestickData,
  HistogramData,
  UTCTimestamp,
  ColorType,
  CrosshairMode,
  MouseEventParams,
} from 'lightweight-charts';
import { CandleStick, TimeFrame } from '@/types/market';
import { timeframeToBinanceInterval } from '@/services/api/candleNormalizer';
import { wsManager } from '@/services/websocket/BinanceWebSocketManager';

export interface TradingViewChartHandle {
  fitContent: () => void;
  resetView: () => void;
}

interface TradingViewChartProps {
  candles: CandleStick[];
  symbol: string;
  timeFrame: TimeFrame;
  livePrice?: number;
  onCrosshairMove?: (candle: CandleStick | null) => void;
  onLiveCandleUpdate?: (candle: CandleStick) => void;
  className?: string;
}

export const TradingViewChart = forwardRef<TradingViewChartHandle, TradingViewChartProps>(
  ({ candles, symbol, timeFrame, livePrice, onCrosshairMove, onLiveCandleUpdate, className }, ref) => {
    const containerRef = useRef<HTMLDivElement>(null);
    const chartRef = useRef<IChartApi | null>(null);
    const candlestickSeriesRef = useRef<ISeriesApi<'Candlestick'> | null>(null);
    const volumeSeriesRef = useRef<ISeriesApi<'Histogram'> | null>(null);
    const candlesMapRef = useRef<Map<number, CandleStick>>(new Map());
    const lastCandleTimeRef = useRef<number>(0);
    const priceLineRef = useRef<IPriceLine | null>(null);

    // Update map for quick crosshair lookup
    useEffect(() => {
      const map = new Map<number, CandleStick>();
      for (const c of candles) {
        map.set(c.time, c);
      }
      candlesMapRef.current = map;
      if (candles.length > 0) {
        lastCandleTimeRef.current = candles[candles.length - 1].time;
      }
    }, [candles]);

    // Expose chart actions to parent (e.g., Toolbar)
    useImperativeHandle(ref, () => ({
      fitContent: () => {
        if (chartRef.current) {
          chartRef.current.timeScale().fitContent();
        }
      },
      resetView: () => {
        if (chartRef.current) {
          chartRef.current.timeScale().resetTimeScale();
          chartRef.current.timeScale().fitContent();
        }
      },
    }));

    // Initialize Chart Instance
    useEffect(() => {
      if (!containerRef.current) return;

      const container = containerRef.current;
      const initialWidth = container.clientWidth || 600;
      const initialHeight = container.clientHeight || 400;

      const chart = createChart(container, {
        width: initialWidth,
        height: initialHeight,
        layout: {
          background: { type: ColorType.Solid, color: '#0c101a' },
          textColor: '#94a3b8',
          fontSize: 11,
          fontFamily: "'JetBrains Mono', monospace",
        },
        grid: {
          vertLines: { color: '#151c2a', style: 1 },
          horzLines: { color: '#151c2a', style: 1 },
        },
        crosshair: {
          mode: CrosshairMode.Normal,
          vertLine: {
            color: 'rgba(56, 189, 248, 0.45)',
            width: 1,
            style: 2,
            labelBackgroundColor: '#1e273a',
          },
          horzLine: {
            color: 'rgba(56, 189, 248, 0.45)',
            width: 1,
            style: 2,
            labelBackgroundColor: '#1e273a',
          },
        },
        rightPriceScale: {
          borderColor: '#1e273a',
          autoScale: true,
          scaleMargins: {
            top: 0.1,
            bottom: 0.22, // leaves room for volume histogram
          },
        },
        timeScale: {
          borderColor: '#1e273a',
          timeVisible: true,
          secondsVisible: false,
          barSpacing: 8,
          minBarSpacing: 3,
        },
        handleScroll: {
          mouseWheel: true,
          pressedMouseMove: true,
          horzTouchDrag: true,
          vertTouchDrag: false,
        },
        handleScale: {
          axisPressedMouseMove: true,
          mouseWheel: true,
          pinch: true,
        },
      });

      // Candlestick Series
      const candlestickSeries = chart.addCandlestickSeries({
        upColor: '#10b981',
        downColor: '#f43f5e',
        borderVisible: false,
        wickUpColor: '#10b981',
        wickDownColor: '#f43f5e',
      });

      // Volume Series (Overlay in bottom 18%)
      const volumeSeries = chart.addHistogramSeries({
        priceFormat: {
          type: 'volume',
        },
        priceScaleId: '', // Overlay without its own scale column
      });

      volumeSeries.priceScale().applyOptions({
        scaleMargins: {
          top: 0.82,
          bottom: 0,
        },
      });

      chartRef.current = chart;
      candlestickSeriesRef.current = candlestickSeries;
      volumeSeriesRef.current = volumeSeries;

      // Crosshair move handler
      const handleCrosshairMove = (param: MouseEventParams) => {
        if (!onCrosshairMove) return;

        if (param.time && typeof param.time === 'number') {
          const candle = candlesMapRef.current.get(param.time);
          if (candle) {
            onCrosshairMove(candle);
            return;
          }
        }
        onCrosshairMove(null);
      };

      chart.subscribeCrosshairMove(handleCrosshairMove);

      // ResizeObserver for fluid container responsiveness
      const resizeObserver = new ResizeObserver((entries) => {
        if (!entries || entries.length === 0) return;
        const entry = entries[0];
        const { width, height } = entry.contentRect;
        if (width > 0 && height > 0) {
          chart.applyOptions({ width, height });
        }
      });

      resizeObserver.observe(container);

      // Memory leak cleanup
      return () => {
        resizeObserver.disconnect();
        chart.unsubscribeCrosshairMove(handleCrosshairMove);
        if (priceLineRef.current && candlestickSeriesRef.current) {
          try {
            candlestickSeriesRef.current.removePriceLine(priceLineRef.current);
          } catch {
            // ignore
          }
          priceLineRef.current = null;
        }
        chart.remove();
        chartRef.current = null;
        candlestickSeriesRef.current = null;
        volumeSeriesRef.current = null;
      };
    }, []); // Run once on mount

    // Update series data when candles or symbol changes
    useEffect(() => {
      if (!candlestickSeriesRef.current || !volumeSeriesRef.current || !chartRef.current) {
        return;
      }

      if (candles.length === 0) {
        candlestickSeriesRef.current.setData([]);
        volumeSeriesRef.current.setData([]);
        return;
      }

      // Determine price precision dynamically based on asset magnitude
      const samplePrice = candles[candles.length - 1].close;
      let precision = 2;
      let minMove = 0.01;

      if (samplePrice < 0.001) {
        precision = 6;
        minMove = 0.000001;
      } else if (samplePrice < 1) {
        precision = 4;
        minMove = 0.0001;
      } else if (samplePrice < 10) {
        precision = 3;
        minMove = 0.001;
      }

      candlestickSeriesRef.current.applyOptions({
        priceFormat: {
          type: 'price',
          precision,
          minMove,
        },
      });

      // Transform candles into Lightweight Charts format
      const candleData: CandlestickData[] = candles.map((c) => ({
        time: c.time as UTCTimestamp,
        open: c.open,
        high: c.high,
        low: c.low,
        close: c.close,
      }));

      const volumeData: HistogramData[] = candles.map((c) => ({
        time: c.time as UTCTimestamp,
        value: c.volume,
        color: c.close >= c.open ? 'rgba(16, 185, 129, 0.45)' : 'rgba(244, 63, 94, 0.45)',
      }));

      candlestickSeriesRef.current.setData(candleData);
      volumeSeriesRef.current.setData(volumeData);

      // Auto-fit content to show latest visible data nicely
      chartRef.current.timeScale().fitContent();
    }, [candles, symbol]);

    // Synchronize Real-Time Horizontal Price Line with Live Market Ticker Price
    useEffect(() => {
      const series = candlestickSeriesRef.current;
      if (!series || !livePrice || livePrice <= 0) return;

      if (priceLineRef.current) {
        priceLineRef.current.applyOptions({
          price: livePrice,
          title: 'LIVE',
        });
      } else {
        priceLineRef.current = series.createPriceLine({
          price: livePrice,
          color: '#06b6d4',
          lineWidth: 1,
          lineStyle: LineStyle.Dashed,
          axisLabelVisible: true,
          title: 'LIVE',
        });
      }
    }, [livePrice]);

    // Clear price line on symbol change to avoid orphaned markers
    useEffect(() => {
      if (priceLineRef.current && candlestickSeriesRef.current) {
        try {
          candlestickSeriesRef.current.removePriceLine(priceLineRef.current);
        } catch {
          // ignore
        }
        priceLineRef.current = null;
      }
    }, [symbol]);

    // Real-Time Kline Streaming Listener
    useEffect(() => {
      const expectedInterval = timeframeToBinanceInterval(timeFrame);
      const expectedSymbol = symbol.toUpperCase();

      const unsubscribe = wsManager.subscribeKline((kline) => {
        // Discard stale messages from previous symbol or interval
        if (kline.symbol !== expectedSymbol || kline.interval !== expectedInterval) {
          return;
        }

        if (!candlestickSeriesRef.current || !volumeSeriesRef.current) {
          return;
        }

        const candle = kline.candle;
        const lastTime = lastCandleTimeRef.current;

        // Discard out-of-order historical ticks
        if (lastTime > 0 && candle.time < lastTime) {
          return;
        }

        // Incremental series update (reconciled with chart scale)
        candlestickSeriesRef.current.update({
          time: candle.time as UTCTimestamp,
          open: candle.open,
          high: candle.high,
          low: candle.low,
          close: candle.close,
        });

        volumeSeriesRef.current.update({
          time: candle.time as UTCTimestamp,
          value: candle.volume,
          color: candle.close >= candle.open ? 'rgba(16, 185, 129, 0.45)' : 'rgba(244, 63, 94, 0.45)',
        });

        // Update tracking map and last candle time
        candlesMapRef.current.set(candle.time, candle);
        if (candle.time > lastTime) {
          lastCandleTimeRef.current = candle.time;
        }

        onLiveCandleUpdate?.(candle);
      });

      return () => {
        unsubscribe();
      };
    }, [symbol, timeFrame, onLiveCandleUpdate]);

    return (
      <div
        ref={containerRef}
        className={className || 'relative w-full h-full min-h-[380px] select-none'}
      />
    );
  }
);

TradingViewChart.displayName = 'TradingViewChart';
