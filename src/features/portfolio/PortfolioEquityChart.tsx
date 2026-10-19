import React, { useState, useRef, useMemo, useCallback } from 'react';
import { Clock, TrendingUp, TrendingDown } from 'lucide-react';
import { EquitySnapshot } from '@/features/trading/types';
import { INITIAL_CAPITAL } from '@/features/trading/engine/portfolioAccounting';
import { formatCurrency, formatPercentage } from '@/lib/formatters';
import { cn } from '@/lib/utils';

export interface PortfolioEquityChartProps {
  equitySnapshots: EquitySnapshot[];
  currentEquity?: number;
  startingCapital?: number;
  className?: string;
}

export const PortfolioEquityChart: React.FC<PortfolioEquityChartProps> = ({
  equitySnapshots,
  currentEquity,
  startingCapital = INITIAL_CAPITAL,
  className,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);

  const effectiveCurrentEquity =
    currentEquity !== undefined
      ? currentEquity
      : equitySnapshots.length > 0
        ? equitySnapshots[equitySnapshots.length - 1].totalEquity
        : startingCapital;

  // Active snapshot (either hovered or the latest one)
  const isHovering = hoveredIndex !== null && hoveredIndex < equitySnapshots.length;
  const activeSnapshot = isHovering
    ? equitySnapshots[hoveredIndex]
    : equitySnapshots.length > 0
      ? equitySnapshots[equitySnapshots.length - 1]
      : null;

  const displayEquity = activeSnapshot ? activeSnapshot.totalEquity : effectiveCurrentEquity;
  const netPnl = displayEquity - startingCapital;
  const returnPercent = startingCapital > 0 ? (netPnl / startingCapital) * 100 : 0;
  const isProfitable = netPnl >= 0;

  // Dynamic Y-axis calculation
  const chartMetrics = useMemo(() => {
    if (equitySnapshots.length < 2) {
      return null;
    }

    const values = equitySnapshots.map((s) => s.totalEquity);
    const minVal = Math.min(...values);
    const maxVal = Math.max(...values);
    const spread = maxVal - minVal;

    // Responsive padding logic:
    // If spread is tiny (e.g. < $2.00 after a small fee deduction or minor tick),
    // allocate padding so that small variations (like -$1.24) occupy ~60% of the chart height.
    // If spread is larger, allocate 12% headroom and footroom.
    let padding: number;
    if (spread < 2.0) {
      padding = Math.max((2.0 - spread) / 2, 0.5);
    } else {
      padding = spread * 0.12;
    }

    const chartMin = minVal - padding;
    const chartMax = maxVal + padding;
    const chartRange = chartMax - chartMin || 1;

    // ViewBox dimensions: 1000 width, 200 height
    const viewWidth = 1000;
    const viewHeight = 200;
    const padX = 20;
    const padTop = 20;
    const padBottom = 20;
    const plotWidth = viewWidth - padX * 2;
    const plotHeight = viewHeight - padTop - padBottom;

    const points = equitySnapshots.map((s, idx) => {
      const x = padX + (idx / (equitySnapshots.length - 1)) * plotWidth;
      const normalizedY = (s.totalEquity - chartMin) / chartRange;
      const y = padTop + (1 - normalizedY) * plotHeight;
      return { x, y, snapshot: s };
    });

    const polylinePoints = points.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ');
    const firstPoint = points[0];
    const lastPoint = points[points.length - 1];
    const polygonPoints = `${firstPoint.x.toFixed(1)},${viewHeight} ${polylinePoints} ${lastPoint.x.toFixed(1)},${viewHeight}`;

    // 3 Reference levels (Max, Mid, Min)
    const midVal = (chartMax + chartMin) / 2;
    const midY = padTop + 0.5 * plotHeight;
    const topY = padTop;
    const bottomY = padTop + plotHeight;

    return {
      chartMin,
      chartMax,
      midVal,
      points,
      polylinePoints,
      polygonPoints,
      viewWidth,
      viewHeight,
      topY,
      midY,
      bottomY,
      padX,
      plotWidth,
    };
  }, [equitySnapshots]);

  // Handle pointer interactions
  const handlePointerMove = useCallback(
    (clientX: number) => {
      if (!containerRef.current || !chartMetrics || equitySnapshots.length < 2) return;
      const rect = containerRef.current.getBoundingClientRect();
      const relativeX = clientX - rect.left;
      const clampedX = Math.max(0, Math.min(relativeX, rect.width));
      const ratio = clampedX / rect.width;
      const index = Math.round(ratio * (equitySnapshots.length - 1));
      setHoveredIndex(Math.max(0, Math.min(index, equitySnapshots.length - 1)));
    },
    [chartMetrics, equitySnapshots]
  );

  const onMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    handlePointerMove(e.clientX);
  };

  const onTouchMove = (e: React.TouchEvent<HTMLDivElement>) => {
    if (e.touches.length > 0) {
      handlePointerMove(e.touches[0].clientX);
    }
  };

  const onPointerLeave = () => {
    setHoveredIndex(null);
  };

  const strokeColor = isProfitable ? '#10b981' : '#f43f5e';
  const gradientId = `equityGradient-${isProfitable ? 'emerald' : 'rose'}`;

  return (
    <div className={cn('flex flex-col space-y-3 w-full select-none', className)}>
      {/* Performance Summary Banner */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 py-2 px-3 bg-[#080c14] rounded-lg border border-[#182030] text-xs font-mono">
        <div className="flex flex-col">
          <span className="text-[10px] text-slate-500 uppercase tracking-wider">Starting Capital</span>
          <span className="text-slate-200 font-semibold">{formatCurrency(startingCapital)}</span>
        </div>

        <div className="flex flex-col">
          <div className="flex items-center gap-1">
            <span className="text-[10px] text-slate-500 uppercase tracking-wider">
              {isHovering ? 'Inspecting Equity' : 'Current Equity'}
            </span>
            {isHovering && (
              <span className="text-[9px] px-1 py-0.2 bg-cyan-950/80 text-cyan-400 border border-cyan-800/50 rounded">
                Point #{hoveredIndex + 1}
              </span>
            )}
          </div>
          <span className="text-white font-bold">{formatCurrency(displayEquity)}</span>
        </div>

        <div className="flex flex-col">
          <span className="text-[10px] text-slate-500 uppercase tracking-wider">Net P&L</span>
          <div className={cn('flex items-center gap-0.5 font-semibold', isProfitable ? 'text-emerald-400' : 'text-rose-400')}>
            {isProfitable ? <TrendingUp className="h-3 w-3" /> : <TrendingDown className="h-3 w-3" />}
            <span>
              {netPnl >= 0 ? '+' : ''}
              {formatCurrency(netPnl)}
            </span>
          </div>
        </div>

        <div className="flex flex-col">
          <span className="text-[10px] text-slate-500 uppercase tracking-wider">Return</span>
          <span className={cn('font-bold', isProfitable ? 'text-emerald-400' : 'text-rose-400')}>
            {formatPercentage(returnPercent)}
          </span>
        </div>
      </div>

      {/* Chart Canvas or Baseline Initialized State */}
      <div
        ref={containerRef}
        data-testid="portfolio-equity-chart-container"
        className="relative w-full h-44 rounded-lg bg-[#070b12] border border-[#151c2a] p-2 flex flex-col justify-between overflow-hidden"
        onMouseMove={onMouseMove}
        onMouseLeave={onPointerLeave}
        onTouchMove={onTouchMove}
        onTouchEnd={onPointerLeave}
      >
        {equitySnapshots.length <= 1 || !chartMetrics ? (
          <div className="h-full w-full flex flex-col items-center justify-center text-center p-4 space-y-1.5">
            <Clock className="h-6 w-6 text-slate-600 animate-pulse" />
            <p className="text-xs font-semibold text-slate-300">Baseline Equity Initialized</p>
            <p className="text-[11px] text-slate-500 max-w-sm">
              Snapshots are genuinely sampled when trades execute or portfolio valuations change over time. No fabricated performance data is generated.
            </p>
          </div>
        ) : (
          <>
            {/* SVG Interactive Chart */}
            <div className="relative w-full h-32 flex-1">
              <svg
                viewBox={`0 0 ${chartMetrics.viewWidth} ${chartMetrics.viewHeight}`}
                preserveAspectRatio="none"
                className="w-full h-full overflow-visible"
              >
                <defs>
                  <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={strokeColor} stopOpacity="0.28" />
                    <stop offset="100%" stopColor={strokeColor} stopOpacity="0.0" />
                  </linearGradient>
                </defs>

                {/* Horizontal reference grid lines */}
                <line
                  x1="0"
                  y1={chartMetrics.topY}
                  x2={chartMetrics.viewWidth}
                  y2={chartMetrics.topY}
                  stroke="#1a2334"
                  strokeDasharray="4 4"
                  strokeWidth="1"
                />
                <line
                  x1="0"
                  y1={chartMetrics.midY}
                  x2={chartMetrics.viewWidth}
                  y2={chartMetrics.midY}
                  stroke="#1a2334"
                  strokeDasharray="4 4"
                  strokeWidth="1"
                />
                <line
                  x1="0"
                  y1={chartMetrics.bottomY}
                  x2={chartMetrics.viewWidth}
                  y2={chartMetrics.bottomY}
                  stroke="#1a2334"
                  strokeDasharray="4 4"
                  strokeWidth="1"
                />

                {/* Area Gradient Fill */}
                <polygon points={chartMetrics.polygonPoints} fill={`url(#${gradientId})`} />

                {/* Main Trend Line */}
                <polyline
                  fill="none"
                  stroke={strokeColor}
                  strokeWidth="2.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  points={chartMetrics.polylinePoints}
                />

                {/* Interactive Hover Point and Crosshair */}
                {isHovering && hoveredIndex < chartMetrics.points.length && (
                  <g data-testid="equity-chart-crosshair">
                    {/* Vertical crosshair line */}
                    <line
                      x1={chartMetrics.points[hoveredIndex].x}
                      y1="0"
                      x2={chartMetrics.points[hoveredIndex].x}
                      y2={chartMetrics.viewHeight}
                      stroke="#38bdf8"
                      strokeWidth="1.5"
                      strokeDasharray="3 3"
                    />
                    {/* Outer pulse aura */}
                    <circle
                      cx={chartMetrics.points[hoveredIndex].x}
                      cy={chartMetrics.points[hoveredIndex].y}
                      r="9"
                      fill={strokeColor}
                      fillOpacity="0.25"
                    />
                    {/* Inner point marker */}
                    <circle
                      cx={chartMetrics.points[hoveredIndex].x}
                      cy={chartMetrics.points[hoveredIndex].y}
                      r="4.5"
                      fill={strokeColor}
                      stroke="#080c14"
                      strokeWidth="2"
                    />
                  </g>
                )}
              </svg>

              {/* Dynamic Y-Axis Labels overlay on the right */}
              <div className="absolute right-1 top-0 bottom-0 pointer-events-none flex flex-col justify-between text-[9px] font-mono text-slate-500 py-1 pr-1 text-right">
                <span className="bg-[#070b12]/80 px-1 rounded">{formatCurrency(chartMetrics.chartMax)}</span>
                <span className="bg-[#070b12]/80 px-1 rounded">{formatCurrency(chartMetrics.midVal)}</span>
                <span className="bg-[#070b12]/80 px-1 rounded">{formatCurrency(chartMetrics.chartMin)}</span>
              </div>

              {/* Floating Tooltip Card */}
              {isHovering && hoveredIndex < chartMetrics.points.length && activeSnapshot && (
                <div
                  data-testid="equity-chart-tooltip"
                  className="absolute pointer-events-none z-20 bg-[#0d1424]/95 border border-[#223048] rounded shadow-xl p-2 text-[10px] font-mono text-slate-300 backdrop-blur-sm transition-all"
                  style={{
                    left: `${Math.min(
                      Math.max(10, (hoveredIndex / (equitySnapshots.length - 1)) * 100),
                      72
                    )}%`,
                    top: '8px',
                  }}
                >
                  <div className="text-[9px] text-slate-400 border-b border-[#1b263b] pb-1 mb-1 flex items-center justify-between gap-3">
                    <span className="text-cyan-400 font-semibold">Snapshot #{hoveredIndex + 1}</span>
                    <span>{new Date(activeSnapshot.timestamp).toLocaleTimeString()}</span>
                  </div>
                  <div className="grid grid-cols-2 gap-x-3 gap-y-0.5 text-[10px]">
                    <span className="text-slate-400">Equity:</span>
                    <span className="text-white font-bold text-right">{formatCurrency(activeSnapshot.totalEquity)}</span>
                    <span className="text-slate-400">Net P&L:</span>
                    <span
                      className={cn(
                        'font-semibold text-right',
                        activeSnapshot.totalEquity >= startingCapital ? 'text-emerald-400' : 'text-rose-400'
                      )}
                    >
                      {activeSnapshot.totalEquity >= startingCapital ? '+' : ''}
                      {formatCurrency(activeSnapshot.totalEquity - startingCapital)}
                    </span>
                    <span className="text-slate-400">Return:</span>
                    <span
                      className={cn(
                        'font-semibold text-right',
                        activeSnapshot.totalEquity >= startingCapital ? 'text-emerald-400' : 'text-rose-400'
                      )}
                    >
                      {formatPercentage(
                        startingCapital > 0
                          ? ((activeSnapshot.totalEquity - startingCapital) / startingCapital) * 100
                          : 0
                      )}
                    </span>
                  </div>
                </div>
              )}
            </div>

            {/* Time stamps footer */}
            <div className="flex justify-between items-center text-[10px] font-mono text-slate-500 pt-1.5 border-t border-[#151c2a]">
              <span>
                Start: {new Date(equitySnapshots[0].timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
              </span>
              <span className="text-slate-400 hidden sm:inline-block">
                {equitySnapshots.length} verified trade & valuation snapshots
              </span>
              <span>
                Latest: {new Date(equitySnapshots[equitySnapshots.length - 1].timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
              </span>
            </div>
          </>
        )}
      </div>
    </div>
  );
};
