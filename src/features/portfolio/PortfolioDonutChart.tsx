import { useState } from 'react';
import { formatCurrency, formatPercentage } from '@/lib/formatters';
import { cn } from '@/lib/utils';

export interface DonutChartItem {
  id: string;
  label: string;
  value: number;
  percent: number;
  color: string;
  isCash?: boolean;
}

interface PortfolioDonutChartProps {
  items: DonutChartItem[];
  totalEquity: number;
  className?: string;
}

function polarToCartesian(
  centerX: number,
  centerY: number,
  radius: number,
  angleInDegrees: number
) {
  const angleInRadians = ((angleInDegrees - 90) * Math.PI) / 180.0;
  return {
    x: centerX + radius * Math.cos(angleInRadians),
    y: centerY + radius * Math.sin(angleInRadians),
  };
}

function describeDonutSlice(
  cx: number,
  cy: number,
  innerRadius: number,
  outerRadius: number,
  startAngle: number,
  endAngle: number
): string {
  const diff = endAngle - startAngle;
  if (diff >= 359.99) {
    // Render full circle donut with two 180-deg arcs
    const midAngle = startAngle + 180;
    const p1Out = polarToCartesian(cx, cy, outerRadius, startAngle);
    const p2Out = polarToCartesian(cx, cy, outerRadius, midAngle);
    const p1In = polarToCartesian(cx, cy, innerRadius, midAngle);
    const p2In = polarToCartesian(cx, cy, innerRadius, startAngle);

    return [
      `M ${p1Out.x} ${p1Out.y}`,
      `A ${outerRadius} ${outerRadius} 0 0 1 ${p2Out.x} ${p2Out.y}`,
      `A ${outerRadius} ${outerRadius} 0 0 1 ${p1Out.x} ${p1Out.y}`,
      `M ${p2In.x} ${p2In.y}`,
      `A ${innerRadius} ${innerRadius} 0 0 0 ${p1In.x} ${p1In.y}`,
      `A ${innerRadius} ${innerRadius} 0 0 0 ${p2In.x} ${p2In.y}`,
      'Z',
    ].join(' ');
  }

  const startOuter = polarToCartesian(cx, cy, outerRadius, startAngle);
  const endOuter = polarToCartesian(cx, cy, outerRadius, endAngle);
  const startInner = polarToCartesian(cx, cy, innerRadius, endAngle);
  const endInner = polarToCartesian(cx, cy, innerRadius, startAngle);

  const largeArcFlag = diff <= 180 ? 0 : 1;

  return [
    `M ${startOuter.x} ${startOuter.y}`,
    `A ${outerRadius} ${outerRadius} 0 ${largeArcFlag} 1 ${endOuter.x} ${endOuter.y}`,
    `L ${startInner.x} ${startInner.y}`,
    `A ${innerRadius} ${innerRadius} 0 ${largeArcFlag} 0 ${endInner.x} ${endInner.y}`,
    'Z',
  ].join(' ');
}

export function PortfolioDonutChart({
  items,
  totalEquity,
  className,
}: PortfolioDonutChartProps) {
  const [hoveredId, setHoveredId] = useState<string | null>(null);

  const cx = 100;
  const cy = 100;
  const outerR = 85;
  const innerR = 60;
  const hoverOuterR = 89;

  // Filter out zero-value items
  const validItems = items.filter((item) => item.value > 0);

  // Compute angles for slices
  const totalVal = validItems.reduce((acc, it) => acc + it.value, 0) || totalEquity || 1;
  const gap = validItems.length > 1 ? 1.5 : 0;
  const availableDegrees = 360 - gap * validItems.length;

  let currentAngle = 0;
  const slices = validItems.map((item) => {
    const sliceDegrees = Math.max((item.value / totalVal) * availableDegrees, 0.5);
    const startAngle = currentAngle + gap / 2;
    const endAngle = startAngle + sliceDegrees;
    currentAngle = endAngle + gap / 2;

    return {
      ...item,
      startAngle,
      endAngle,
    };
  });

  const activeItem = validItems.find((i) => i.id === hoveredId);

  return (
    <div className={cn('flex flex-col items-center select-none', className)}>
      {/* SVG Donut */}
      <div className="relative w-48 h-48 sm:w-52 sm:h-52">
        <svg
          viewBox="0 0 200 200"
          className="w-full h-full filter drop-shadow-md overflow-visible"
        >
          {slices.length === 0 ? (
            <circle
              cx={cx}
              cy={cy}
              r={(outerR + innerR) / 2}
              fill="none"
              stroke="#1e273a"
              strokeWidth={outerR - innerR}
            />
          ) : (
            slices.map((slice) => {
              const isHovered = slice.id === hoveredId;
              const rOut = isHovered ? hoverOuterR : outerR;
              const pathD = describeDonutSlice(
                cx,
                cy,
                innerR,
                rOut,
                slice.startAngle,
                slice.endAngle
              );

              return (
                <path
                  key={slice.id}
                  d={pathD}
                  fill={slice.color}
                  className="transition-all duration-200 cursor-pointer"
                  style={{
                    opacity: hoveredId && !isHovered ? 0.45 : 1,
                    filter: isHovered ? 'brightness(1.15)' : 'none',
                  }}
                  onMouseEnter={() => setHoveredId(slice.id)}
                  onMouseLeave={() => setHoveredId(null)}
                />
              );
            })
          )}
        </svg>

        {/* Center Equity Overlay */}
        <div className="absolute inset-0 flex flex-col items-center justify-center text-center pointer-events-none p-3">
          {activeItem ? (
            <>
              <span className="text-[10px] uppercase font-bold text-slate-400 tracking-wider">
                {activeItem.label}
              </span>
              <span className="text-sm sm:text-base font-bold font-mono text-white tabular-nums">
                {formatCurrency(activeItem.value)}
              </span>
              <span className="text-[11px] font-mono text-cyan-400 font-semibold">
                {formatPercentage(activeItem.percent)}
              </span>
            </>
          ) : (
            <>
              <span className="text-[9px] uppercase font-bold text-slate-400 tracking-wider">
                Total Equity
              </span>
              <span className="text-sm sm:text-base font-bold font-mono text-white tabular-nums">
                {formatCurrency(totalEquity)}
              </span>
              <span className="text-[10px] font-mono text-slate-400">
                {validItems.length} asset{validItems.length === 1 ? '' : 's'}
              </span>
            </>
          )}
        </div>
      </div>

      {/* Legend / Breakdown List */}
      <div className="w-full mt-4 space-y-1.5 divide-y divide-[#151c2b] text-xs font-mono">
        {validItems.map((item) => {
          const isHovered = item.id === hoveredId;

          return (
            <div
              key={item.id}
              onMouseEnter={() => setHoveredId(item.id)}
              onMouseLeave={() => setHoveredId(null)}
              className={cn(
                'flex items-center justify-between pt-1.5 px-2 py-1 rounded cursor-pointer transition-colors',
                isHovered ? 'bg-[#151c2b]' : 'hover:bg-[#111724]'
              )}
            >
              <div className="flex items-center gap-2">
                <span
                  className="h-2.5 w-2.5 rounded-full shrink-0"
                  style={{ backgroundColor: item.color }}
                />
                <span
                  className={cn(
                    'font-medium transition-colors',
                    isHovered ? 'text-cyan-300 font-semibold' : 'text-slate-200'
                  )}
                >
                  {item.label}
                </span>
              </div>
              <div className="text-right">
                <span className="text-slate-200 tabular-nums font-medium">
                  {formatCurrency(item.value)}
                </span>
                <span className="text-slate-400 ml-2 text-[11px] tabular-nums">
                  ({item.percent.toFixed(1)}%)
                </span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
