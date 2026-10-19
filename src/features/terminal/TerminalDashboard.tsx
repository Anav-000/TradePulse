import { useState } from 'react';
import { useMarketStore } from '@/stores/useMarketStore';
import { useUIStore } from '@/stores/useUIStore';
import {
  formatCurrency,
  formatPercentage,
  formatCompactCurrency,
  formatCompactNumber,
  formatOrderBookQuantity,
} from '@/lib/formatters';
import { cn } from '@/lib/utils';
import { Input } from '@/components/ui/input';
import { ChartContainer } from '@/features/chart/ChartContainer';
import { OrderEntryPanel } from '@/features/trading/OrderEntryPanel';
import { BottomDock } from './BottomDock';
import {
  Search,
  ArrowUpRight,
  ArrowDownRight,
} from 'lucide-react';

export function TerminalDashboard() {
  const { tickers, selectedSymbol, setSelectedSymbol, getSelectedTicker, orderBook, connectionStatus } =
    useMarketStore();
  const { isCompactDensity } = useUIStore();

  const selectedTicker = getSelectedTicker();
  const isPositive = selectedTicker.priceChangePercent24h >= 0;

  // Search filter & order book click state
  const [searchFilter, setSearchFilter] = useState('');
  const [clickedPrice, setClickedPrice] = useState<number | null>(null);

  // Live order book or simulated depth fallback
  const midPrice = selectedTicker.lastPrice;
  const isRealOrderBook = Boolean(
    orderBook && orderBook.symbol === selectedTicker.symbol && orderBook.bids.length > 0
  );

  const mockBids = [
    { price: midPrice * 0.9995, amount: 0.842, total: midPrice * 0.9995 * 0.842, depth: 85 },
    { price: midPrice * 0.9990, amount: 1.450, total: midPrice * 0.9990 * 1.450, depth: 65 },
    { price: midPrice * 0.9982, amount: 2.120, total: midPrice * 0.9982 * 2.120, depth: 50 },
    { price: midPrice * 0.9975, amount: 3.840, total: midPrice * 0.9975 * 3.840, depth: 40 },
    { price: midPrice * 0.9960, amount: 5.120, total: midPrice * 0.9960 * 5.120, depth: 25 },
  ];

  const mockAsks = [
    { price: midPrice * 1.0040, amount: 4.820, total: midPrice * 1.0040 * 4.820, depth: 20 },
    { price: midPrice * 1.0025, amount: 3.250, total: midPrice * 1.0025 * 3.250, depth: 38 },
    { price: midPrice * 1.0018, amount: 1.840, total: midPrice * 1.0018 * 1.840, depth: 55 },
    { price: midPrice * 1.0010, amount: 1.150, total: midPrice * 1.0010 * 1.150, depth: 70 },
    { price: midPrice * 1.0005, amount: 0.620, total: midPrice * 1.0005 * 0.620, depth: 90 },
  ];

  const displayBids = isRealOrderBook && orderBook ? orderBook.bids.slice(0, 5) : mockBids;
  const displayAsks = isRealOrderBook && orderBook ? orderBook.asks.slice(0, 5).reverse() : mockAsks;
  const spreadDisplay = isRealOrderBook && orderBook
    ? `Spread ${formatCurrency(orderBook.spread)} (${orderBook.spreadPercentage.toFixed(3)}%)`
    : '0.1 Spread (Simulated)';

  const filteredPairs = tickers.filter(
    (t) =>
      t.symbol.toLowerCase().includes(searchFilter.toLowerCase()) ||
      t.baseAsset.toLowerCase().includes(searchFilter.toLowerCase())
  );

  return (
    <div
      className={cn(
        'grid grid-cols-1 lg:grid-cols-12 gap-2 p-2 min-h-[calc(100vh-80px)]',
        isCompactDensity ? 'text-[11px]' : 'text-xs'
      )}
    >
      {/* LEFT COLUMN: Pair Selector (col-span-2) */}
      <div className="hidden xl:flex xl:col-span-2 flex-col rounded-lg border border-[#1e273a] bg-[#0c101a] overflow-hidden">
        <div className="p-2 border-b border-[#182030] bg-[#090d16]">
          <div className="relative">
            <Search className="absolute left-2.5 top-2 h-3.5 w-3.5 text-slate-500" />
            <Input
              placeholder="Search pairs..."
              value={searchFilter}
              onChange={(e) => setSearchFilter(e.target.value)}
              className="h-7 pl-7 text-[11px] bg-[#07090f]"
            />
          </div>
        </div>

        <div className="flex-1 overflow-y-auto divide-y divide-[#151c2b]">
          {filteredPairs.map((ticker) => {
            const isPairSelected = ticker.symbol === selectedSymbol;
            const isPairPositive = ticker.priceChangePercent24h >= 0;

            return (
              <button
                key={ticker.symbol}
                onClick={() => setSelectedSymbol(ticker.symbol)}
                className={cn(
                  'flex w-full items-center justify-between p-2.5 text-left transition-colors select-none',
                  isPairSelected
                    ? 'bg-[#151c2b] border-l-2 border-cyan-500'
                    : 'hover:bg-[#111724]'
                )}
              >
                <div>
                  <div className="font-semibold text-white flex items-center gap-1">
                    <span>{ticker.baseAsset}</span>
                    <span className="text-[10px] text-slate-500">/{ticker.quoteAsset}</span>
                  </div>
                  <div className="text-[10px] text-slate-500 font-mono">
                    Vol {formatCompactCurrency(ticker.quoteVolume24h)}
                  </div>
                </div>

                <div className="text-right">
                  <div className="font-mono text-slate-100 font-medium">
                    {formatCurrency(ticker.lastPrice)}
                  </div>
                  <div
                    className={cn(
                      'font-mono text-[10px] font-medium',
                      isPairPositive ? 'text-emerald-400' : 'text-rose-400'
                    )}
                  >
                    {formatPercentage(ticker.priceChangePercent24h)}
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      </div>

      {/* CENTER COLUMN: Chart Canvas & Positions/Orders Dock (col-span-7) */}
      <div className="lg:col-span-8 xl:col-span-7 flex flex-col gap-2">
        {/* Interactive TradingView Candlestick Chart */}
        <ChartContainer />

        {/* Bottom Dock: Live Positions, Open Orders & Execution History */}
        <BottomDock />
      </div>

      {/* RIGHT COLUMN: Order Book & Order Entry Form (col-span-4 / col-span-3) */}
      <div className="lg:col-span-4 xl:col-span-3 flex flex-col gap-2">
        {/* Order Book Depth Visualizer */}
        <div className="rounded-lg border border-[#1e273a] bg-[#0c101a] overflow-hidden flex flex-col">
          <div className="flex items-center justify-between border-b border-[#182030] bg-[#090d16] px-3 py-2">
            <div className="flex items-center gap-1.5">
              <span className="font-semibold text-xs text-white">Order Book</span>
              {isRealOrderBook && (
                <span className="rounded bg-emerald-500/15 text-emerald-400 border border-emerald-500/30 text-[9px] px-1 py-0.2 font-mono">
                  LIVE DEPTH
                </span>
              )}
            </div>
            <span className="text-[10px] text-slate-400 font-mono">{spreadDisplay}</span>
          </div>

          {/* Asks (Sells) */}
          <div className="p-2 space-y-0.5 font-mono text-[11px]">
            <div className="grid grid-cols-3 text-[10px] text-slate-500 uppercase pb-1 border-b border-[#151c2b]">
              <span>Price (USDT)</span>
              <span className="text-right">Size</span>
              <span className="text-right">Total</span>
            </div>
            {displayAsks.map((ask, idx) => (
              <div
                key={idx}
                onClick={() => setClickedPrice(ask.price)}
                title="Click to copy price to order form"
                className="relative grid grid-cols-3 py-0.5 text-rose-400 group cursor-pointer hover:bg-rose-500/15 transition-colors"
              >
                <div
                  className="absolute right-0 top-0 bottom-0 bg-rose-500/10 pointer-events-none"
                  style={{ width: `${ask.depth || 50}%` }}
                />
                <span className="relative z-10">{ask.price.toFixed(2)}</span>
                <span className="relative z-10 text-right text-slate-300">
                  {formatOrderBookQuantity(ask.amount)}
                </span>
                <span className="relative z-10 text-right text-slate-400">{formatCompactNumber(ask.total)}</span>
              </div>
            ))}
          </div>

          {/* Mid Market Price Divider */}
          <div className="flex items-center justify-between bg-[#0e1422] border-y border-[#182030] px-3 py-1.5 font-mono">
            <div className="flex items-center gap-1.5">
              <span className="text-xs font-bold text-white">{formatCurrency(selectedTicker.lastPrice)}</span>
              {isPositive ? (
                <ArrowUpRight className="h-3 w-3 text-emerald-400" />
              ) : (
                <ArrowDownRight className="h-3 w-3 text-rose-400" />
              )}
            </div>
            <span className="text-[10px] text-slate-500">Market Price</span>
          </div>

          {/* Bids (Buys) */}
          <div className="p-2 space-y-0.5 font-mono text-[11px]">
            {displayBids.map((bid, idx) => (
              <div
                key={idx}
                onClick={() => setClickedPrice(bid.price)}
                title="Click to copy price to order form"
                className="relative grid grid-cols-3 py-0.5 text-emerald-400 group cursor-pointer hover:bg-emerald-500/15 transition-colors"
              >
                <div
                  className="absolute right-0 top-0 bottom-0 bg-emerald-500/10 pointer-events-none"
                  style={{ width: `${bid.depth || 50}%` }}
                />
                <span className="relative z-10">{bid.price.toFixed(2)}</span>
                <span className="relative z-10 text-right text-slate-300">
                  {formatOrderBookQuantity(bid.amount)}
                </span>
                <span className="relative z-10 text-right text-slate-400">{formatCompactNumber(bid.total)}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Order Placement Panel */}
        <OrderEntryPanel
          selectedTicker={selectedTicker}
          orderBook={orderBook}
          connectionStatus={connectionStatus}
          externalPrice={clickedPrice}
          onExternalPriceHandled={() => setClickedPrice(null)}
        />
      </div>
    </div>
  );
}
