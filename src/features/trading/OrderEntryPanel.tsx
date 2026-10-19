import { useState, useEffect, useRef } from 'react';
import { CryptoTicker, OrderBookData, ConnectionStatus } from '@/types/market';
import { formatCurrency, formatPercentage } from '@/lib/formatters';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import {
  RotateCcw,
  AlertCircle,
  Info,
  Zap,
  Loader2,
  Shield,
  ShieldCheck,
  TrendingDown,
  TrendingUp,
  X,
} from 'lucide-react';
import { useTradingStore } from '@/features/trading/stores/useTradingStore';
import { validateProtectiveOrderSetup } from '@/features/trading/engine/orderEngine';
import {
  MAX_QUANTITY_DECIMALS,
  MIN_ORDER_NOTIONAL_USDT,
  MAX_SAFE_QUANTITY,
  MAX_SAFE_PRICE,
  countDecimals,
  getMaxPriceDecimals,
} from '@/features/trading/engine/orderValidator';

export const SIMULATED_FEE_RATE = 0.0005; // 0.05% fee
export const AVAILABLE_PAPER_BALANCE = 50000.00; // Default $50k virtual USDT

interface OrderEntryPanelProps {
  selectedTicker: CryptoTicker;
  orderBook: OrderBookData | null;
  connectionStatus: ConnectionStatus;
  externalPrice?: number | null;
  onExternalPriceHandled?: () => void;
}

export function OrderEntryPanel({
  selectedTicker,
  orderBook,
  connectionStatus,
  externalPrice,
  onExternalPriceHandled,
}: OrderEntryPanelProps) {
  const currentSymbol = selectedTicker.symbol;
  const currentMarketPrice = selectedTicker.lastPrice > 0 ? selectedTicker.lastPrice : 0;

  // Connect to trading store
  const {
    executeMarketOrder,
    placeLimitOrder,
    setProtectiveOrder,
    cancelProtectiveOrder,
    getActiveProtectiveOrders,
    getAvailableUsdt,
    getPosition,
    isSubmitting,
  } = useTradingStore();

  const availableUsdt = getAvailableUsdt();
  const currentPosition = getPosition(currentSymbol);
  const availableHolding = currentPosition ? currentPosition.availableQuantity : 0;
  const activeProtections = getActiveProtectiveOrders(currentSymbol);

  // Best executable quotes from live order book or ticker lastPrice
  const bestBid =
    orderBook && orderBook.symbol === currentSymbol && orderBook.bids.length > 0
      ? orderBook.bids[0].price
      : currentMarketPrice;

  const bestAsk =
    orderBook && orderBook.symbol === currentSymbol && orderBook.asks.length > 0
      ? orderBook.asks[0].price
      : currentMarketPrice;

  const [orderSide, setOrderSide] = useState<'buy' | 'sell'>('buy');
  const [orderType, setOrderType] = useState<'limit' | 'market' | 'tpsl'>('limit');
  const [limitPrice, setLimitPrice] = useState<string>(
    currentMarketPrice > 0 ? currentMarketPrice.toString() : ''
  );
  const [isLimitPriceManual, setIsLimitPriceManual] = useState<boolean>(false);
  const [orderAmount, setOrderAmount] = useState<string>('0.1');

  // TP/SL State
  const [protectiveAmount, setProtectiveAmount] = useState<string>('');
  const [enableTp, setEnableTp] = useState<boolean>(true);
  const [enableSl, setEnableSl] = useState<boolean>(true);
  const [tpPrice, setTpPrice] = useState<string>('');
  const [slPrice, setSlPrice] = useState<string>('');

  // Track previous symbol to detect pair switching
  const prevSymbolRef = useRef<string>(currentSymbol);
  const isMountedRef = useRef<boolean>(true);

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  // Executable quote: Ask for Buy, Bid for Sell
  const executableQuote = orderSide === 'buy' ? bestAsk : bestBid;

  // 1. When cryptocurrency changes, reset manual flag and sync to new asset's market price
  useEffect(() => {
    if (prevSymbolRef.current !== currentSymbol) {
      prevSymbolRef.current = currentSymbol;
      setIsLimitPriceManual(false);
      if (currentMarketPrice > 0) {
        setLimitPrice(currentMarketPrice.toString());
      } else {
        setLimitPrice('');
      }
      setProtectiveAmount('');
      setTpPrice('');
      setSlPrice('');
    }
  }, [currentSymbol, currentMarketPrice]);

  // 2. When live market ticks arrive, update limit price only if user hasn't manually edited it
  useEffect(() => {
    if (!isLimitPriceManual && currentMarketPrice > 0) {
      setLimitPrice(currentMarketPrice.toString());
    }
  }, [currentMarketPrice, isLimitPriceManual]);

  // 3. When external price is clicked in Order Book, set price and mark as manual
  useEffect(() => {
    if (externalPrice && externalPrice > 0) {
      setLimitPrice(externalPrice.toString());
      setIsLimitPriceManual(true);
      if (orderType === 'market') {
        setOrderType('limit');
      }
      onExternalPriceHandled?.();
    }
  }, [externalPrice, orderType, onExternalPriceHandled]);

  // Handle manual input of limit price
  const handleLimitPriceChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setLimitPrice(e.target.value);
    setIsLimitPriceManual(true);
  };

  // Reset limit price back to live market price
  const handleResetToMarket = () => {
    setIsLimitPriceManual(false);
    if (currentMarketPrice > 0) {
      setLimitPrice(currentMarketPrice.toString());
    }
  };

  // Standard Limit & Market Calculations
  const effectivePrice =
    orderType === 'market' ? executableQuote : parseFloat(limitPrice) || 0;
  const quantity = parseFloat(orderAmount) || 0;

  const isPriceFinite = Number.isFinite(effectivePrice) && effectivePrice > 0 && effectivePrice <= MAX_SAFE_PRICE;
  const isPricePrecisionValid = isPriceFinite && countDecimals(effectivePrice) <= getMaxPriceDecimals(effectivePrice);
  const isPriceValid = isPriceFinite && isPricePrecisionValid;

  const isQuantityFinite = Number.isFinite(quantity) && quantity > 0 && quantity <= MAX_SAFE_QUANTITY;
  const isQuantityPrecisionValid = isQuantityFinite && countDecimals(quantity) <= MAX_QUANTITY_DECIMALS;
  const isQuantityValid = isQuantityFinite && isQuantityPrecisionValid;

  const rawOrderValue = isPriceFinite && isQuantityFinite ? effectivePrice * quantity : 0;
  const isNotionalValid = rawOrderValue >= MIN_ORDER_NOTIONAL_USDT;

  const orderValue = Math.round(rawOrderValue * 100) / 100;
  const estimatedFee = Math.round(orderValue * SIMULATED_FEE_RATE * 100) / 100;
  const totalRequiredUSDT = orderSide === 'buy' ? orderValue + estimatedFee : 0;

  const isBalanceSufficient =
    orderSide === 'buy'
      ? totalRequiredUSDT <= availableUsdt
      : quantity <= availableHolding;

  // Percentage presets for Buy/Sell
  const handlePercentagePreset = (pct: number) => {
    if (orderSide === 'buy') {
      if (!isPriceValid || effectivePrice <= 0) return;
      const budget = availableUsdt * (pct / 100);
      const targetAmount = budget / (effectivePrice * (1 + SIMULATED_FEE_RATE));

      let precision = 4;
      if (effectivePrice < 1) precision = 2;
      else if (effectivePrice < 10) precision = 3;
      else if (effectivePrice > 10000) precision = 5;

      setOrderAmount(targetAmount.toFixed(precision));
    } else {
      if (availableHolding <= 0) {
        setOrderAmount('0');
        return;
      }
      const targetAmount = availableHolding * (pct / 100);
      setOrderAmount(targetAmount.toFixed(4));
    }
  };

  // Protective percentage presets
  const handleProtectivePreset = (pct: number) => {
    if (availableHolding <= 0) {
      setProtectiveAmount('0');
      return;
    }
    const target = availableHolding * (pct / 100);
    setProtectiveAmount(target.toFixed(4));
  };

  // Quick TP / SL trigger price percentage presets
  const handleTpPreset = (pct: number) => {
    if (bestBid <= 0) return;
    const targetPrice = bestBid * (1 + pct / 100);
    setTpPrice(targetPrice.toFixed(2));
    setEnableTp(true);
  };

  const handleSlPreset = (pct: number) => {
    if (bestBid <= 0) return;
    const targetPrice = bestBid * (1 - pct / 100);
    setSlPrice(targetPrice.toFixed(2));
    setEnableSl(true);
  };

  // Protective Calculations
  const protQuantity = parseFloat(protectiveAmount) || 0;
  const numTp = enableTp && tpPrice ? parseFloat(tpPrice) : undefined;
  const numSl = enableSl && slPrice ? parseFloat(slPrice) : undefined;

  const liveQuoteObj = {
    symbol: currentSymbol,
    bidPrice: bestBid,
    askPrice: bestAsk,
    lastPrice: currentMarketPrice,
    timestamp: Date.now(),
  };

  const protValidation =
    orderType === 'tpsl'
      ? validateProtectiveOrderSetup(
          protQuantity,
          numSl,
          numTp,
          currentPosition,
          liveQuoteObj
        )
      : { isValid: false };

  // Validation status: prevent market orders or zero-price limit orders when disconnected/stale
  const isMarketDataStaleOrDisconnected =
    (connectionStatus === 'disconnected' || connectionStatus === 'stale') &&
    (currentMarketPrice <= 0 || orderType === 'market' || orderType === 'tpsl');

  const canSubmit =
    orderType === 'tpsl'
      ? protValidation.isValid && !isMarketDataStaleOrDisconnected && !isSubmitting
      : isPriceValid &&
        isQuantityValid &&
        isNotionalValid &&
        isBalanceSufficient &&
        !isMarketDataStaleOrDisconnected &&
        !isSubmitting;

  const getSubmitButtonLabel = () => {
    if (isSubmitting) {
      return 'Processing...';
    }
    if (isMarketDataStaleOrDisconnected) {
      if (currentMarketPrice <= 0) {
        return 'Market Data Unavailable';
      }
      return connectionStatus === 'disconnected' ? 'Exchange Disconnected' : 'Market Data Stale';
    }

    if (orderType === 'tpsl') {
      if (!currentPosition || currentPosition.quantity <= 0) {
        return `No ${selectedTicker.baseAsset} Holdings to Protect`;
      }
      if (availableHolding <= 0) {
        return `All ${selectedTicker.baseAsset} Holdings Locked`;
      }
      if (!Number.isFinite(protQuantity) || protQuantity <= 0) {
        return 'Enter Protection Quantity';
      }
      if (countDecimals(protQuantity) > MAX_QUANTITY_DECIMALS) {
        return `Quantity Max ${MAX_QUANTITY_DECIMALS} Decimals`;
      }
      if (protQuantity > availableHolding) {
        return 'Quantity Exceeds Available Holdings';
      }
      if (!enableTp && !enableSl) {
        return 'Select Stop-Loss or Take-Profit';
      }
      if (enableSl) {
        if (!numSl || numSl <= 0) return 'Enter Valid Stop-Loss Price';
        if (countDecimals(numSl) > getMaxPriceDecimals(numSl)) return `SL Price Max ${getMaxPriceDecimals(numSl)} Decimals`;
        if (numSl >= bestBid) return 'Stop-Loss Must Be Below Market Bid';
      }
      if (enableTp) {
        if (!numTp || numTp <= 0) return 'Enter Valid Take-Profit Price';
        if (countDecimals(numTp) > getMaxPriceDecimals(numTp)) return `TP Price Max ${getMaxPriceDecimals(numTp)} Decimals`;
        if (numTp <= bestBid) return 'Take-Profit Must Be Above Market Bid';
      }
      if (enableSl && enableTp && numSl && numTp && numSl >= numTp) {
        return 'Stop-Loss Must Be Lower Than Take-Profit';
      }
      if (protValidation.error) {
        return protValidation.error;
      }
      if (enableSl && enableTp) {
        return `Activate Linked OCO Protection (${protQuantity} ${selectedTicker.baseAsset})`;
      }
      return `Activate ${enableSl ? 'Stop-Loss' : 'Take-Profit'} (${protQuantity} ${selectedTicker.baseAsset})`;
    }

    if (!isPriceFinite) {
      return 'Enter Valid Price';
    }
    if (!isPricePrecisionValid) {
      return `Price Max ${getMaxPriceDecimals(effectivePrice)} Decimals`;
    }
    if (!isQuantityFinite) {
      return 'Enter Valid Quantity';
    }
    if (!isQuantityPrecisionValid) {
      return `Quantity Max ${MAX_QUANTITY_DECIMALS} Decimals`;
    }
    if (!isNotionalValid) {
      return `Min Notional: $${MIN_ORDER_NOTIONAL_USDT.toFixed(2)} USDT`;
    }
    if (!isBalanceSufficient) {
      return orderSide === 'buy'
        ? 'Insufficient USDT Balance'
        : `Insufficient ${selectedTicker.baseAsset} Holdings`;
    }
    return `${orderSide === 'buy' ? 'Simulate Buy' : 'Simulate Sell'} ${selectedTicker.baseAsset}`;
  };

  const handleOrderSubmit = async () => {
    if (!canSubmit) return;

    if (orderType === 'tpsl') {
      const res = await setProtectiveOrder({
        symbol: selectedTicker.symbol,
        baseAsset: selectedTicker.baseAsset,
        quoteAsset: selectedTicker.quoteAsset,
        quantity: protQuantity,
        stopLossPrice: numSl,
        takeProfitPrice: numTp,
        quote: liveQuoteObj,
      });

      if (res?.success && isMountedRef.current) {
        setProtectiveAmount('');
      }
      return;
    }

    if (orderType === 'market') {
      const submittedAmount = orderAmount;
      const res = await executeMarketOrder({
        symbol: selectedTicker.symbol,
        baseAsset: selectedTicker.baseAsset,
        quoteAsset: selectedTicker.quoteAsset,
        side: orderSide,
        quantity,
      });

      if (res?.success && isMountedRef.current) {
        setOrderAmount((prev) => (prev === submittedAmount ? '' : prev));
      }
    } else {
      await placeLimitOrder({
        symbol: selectedTicker.symbol,
        baseAsset: selectedTicker.baseAsset,
        quoteAsset: selectedTicker.quoteAsset,
        side: orderSide,
        quantity,
        limitPrice: parseFloat(limitPrice),
      });
    }
  };

  return (
    <div className="rounded-lg border border-[#1e273a] bg-[#0c101a] overflow-hidden flex flex-col p-3 space-y-3 select-none">
      {/* Buy / Sell Toggle Tabs */}
      {orderType !== 'tpsl' ? (
        <div className="grid grid-cols-2 gap-1 rounded-md bg-[#06080e] p-1 border border-[#182030]">
          <button
            onClick={() => setOrderSide('buy')}
            className={cn(
              'py-1.5 rounded text-xs font-bold transition-all',
              orderSide === 'buy'
                ? 'bg-emerald-600 text-white shadow-md shadow-emerald-950'
                : 'text-slate-400 hover:text-white'
            )}
          >
            Buy {selectedTicker.baseAsset}
          </button>
          <button
            onClick={() => setOrderSide('sell')}
            className={cn(
              'py-1.5 rounded text-xs font-bold transition-all',
              orderSide === 'sell'
                ? 'bg-rose-600 text-white shadow-md shadow-rose-950'
                : 'text-slate-400 hover:text-white'
            )}
          >
            Sell {selectedTicker.baseAsset}
          </button>
        </div>
      ) : (
        <div className="flex items-center justify-between bg-purple-950/20 border border-purple-800/40 rounded p-2 text-xs">
          <div className="flex items-center gap-1.5 text-purple-300 font-semibold">
            <ShieldCheck className="h-4 w-4 text-purple-400" />
            <span>Position Protection (Exit)</span>
          </div>
          <span className="text-[10px] text-slate-400 font-mono">
            {selectedTicker.baseAsset} Spot Holding
          </span>
        </div>
      )}

      {/* Order Type: Limit / Market / TP/SL */}
      <div className="flex items-center justify-between border-b border-[#182030] pb-2">
        <div className="flex items-center gap-3">
          <button
            onClick={() => setOrderType('limit')}
            className={cn(
              'text-xs font-medium pb-0.5 border-b-2 transition-colors',
              orderType === 'limit'
                ? 'border-cyan-400 text-cyan-400 font-semibold'
                : 'border-transparent text-slate-500 hover:text-slate-300'
            )}
          >
            Limit
          </button>
          <button
            onClick={() => setOrderType('market')}
            className={cn(
              'text-xs font-medium pb-0.5 border-b-2 transition-colors',
              orderType === 'market'
                ? 'border-cyan-400 text-cyan-400 font-semibold'
                : 'border-transparent text-slate-500 hover:text-slate-300'
            )}
          >
            Market
          </button>
          <button
            onClick={() => {
              setOrderType('tpsl');
              setOrderSide('sell');
            }}
            className={cn(
              'text-xs font-medium pb-0.5 border-b-2 transition-colors flex items-center gap-1',
              orderType === 'tpsl'
                ? 'border-purple-400 text-purple-400 font-semibold'
                : 'border-transparent text-slate-500 hover:text-slate-300'
            )}
          >
            <Shield className="h-3 w-3" />
            <span>TP / SL</span>
          </button>
        </div>

        {/* Live quote glance */}
        <div className="text-[10px] text-slate-400 font-mono">
          <span className="text-slate-500 mr-1">{orderSide === 'buy' ? 'Ask:' : 'Bid:'}</span>
          <span className="text-slate-200">{formatCurrency(executableQuote)}</span>
        </div>
      </div>

      {/* ======================================================== */}
      {/* 1. LIMIT & MARKET ORDER ENTRY FORM */}
      {/* ======================================================== */}
      {orderType !== 'tpsl' && (
        <>
          {/* Price input section */}
          {orderType === 'limit' ? (
            <div className="space-y-1">
              <div className="flex justify-between items-center text-[11px] text-slate-400">
                <span className="flex items-center gap-1.5">
                  <span>Price</span>
                  {isLimitPriceManual ? (
                    <button
                      onClick={handleResetToMarket}
                      className="flex items-center gap-0.5 text-[9px] text-cyan-400 hover:text-cyan-300 bg-cyan-950/40 border border-cyan-800/40 rounded px-1 py-0.2"
                      title="Reset to current market price"
                    >
                      <RotateCcw className="h-2.5 w-2.5" />
                      <span>Sync Market</span>
                    </button>
                  ) : (
                    <span className="text-[9px] text-emerald-400/80 font-mono">
                      (Live Market Tracked)
                    </span>
                  )}
                </span>
                <span className="font-mono text-slate-500">{selectedTicker.quoteAsset}</span>
              </div>
              <Input
                type="number"
                mono
                aria-label="Price"
                data-testid="order-price-input"
                value={limitPrice}
                onChange={handleLimitPriceChange}
                placeholder="0.00"
                min="0"
                step="any"
              />
            </div>
          ) : (
            <div className="rounded border border-[#161d2d] bg-[#070a10] p-2 space-y-1">
              <div className="flex justify-between items-center text-[11px] text-slate-400">
                <span>Market Reference</span>
                <span className="font-mono text-slate-500">{selectedTicker.quoteAsset}</span>
              </div>
              <div className="text-xs font-mono font-semibold text-white flex items-center justify-between">
                <span>{formatCurrency(executableQuote)}</span>
                <Badge variant="accent" className="text-[9px] py-0">
                  <Zap className="mr-0.5 h-2.5 w-2.5" />
                  {orderSide === 'buy' ? 'Best Ask' : 'Best Bid'}
                </Badge>
              </div>
              <p className="text-[10px] text-slate-500 flex items-start gap-1 pt-0.5 leading-tight">
                <Info className="h-3 w-3 shrink-0 text-slate-500 mt-0.5" />
                <span>Market orders execute at best available live price. Execution may vary.</span>
              </p>
            </div>
          )}

          {/* Amount input section */}
          <div className="space-y-1">
            <div className="flex justify-between text-[11px] text-slate-400">
              <span>Amount</span>
              <span className="font-mono text-slate-500">{selectedTicker.baseAsset}</span>
            </div>
            <Input
              type="number"
              mono
              aria-label="Amount"
              data-testid="order-amount-input"
              value={orderAmount}
              onChange={(e) => setOrderAmount(e.target.value)}
              placeholder="0.00"
              min="0"
              step="any"
            />
          </div>

          {/* Percentage Presets */}
          <div className="grid grid-cols-4 gap-1">
            {[25, 50, 75, 100].map((pct) => (
              <Button
                key={pct}
                variant="outline"
                size="sm"
                className="h-6 text-[10px] font-mono text-slate-400 border-[#1a2334] hover:text-white hover:bg-[#151c2a]"
                onClick={() => handlePercentagePreset(pct)}
              >
                {pct}%
              </Button>
            ))}
          </div>

          {/* Total & Balances Summary */}
          <div className="space-y-1 rounded bg-[#070a10] p-2.5 border border-[#161d2d] text-[11px]">
            <div className="flex justify-between text-slate-400">
              <span>Estimated Order Value:</span>
              <span className="font-mono text-white font-medium">
                {formatCurrency(orderValue)}
              </span>
            </div>
            <div className="flex justify-between text-slate-400">
              <span>Simulated Fee ({formatPercentage(SIMULATED_FEE_RATE * 100)}):</span>
              <span className="font-mono text-slate-300">
                {formatCurrency(estimatedFee)}
              </span>
            </div>
            {orderSide === 'buy' ? (
              <div className="flex justify-between text-slate-400 border-t border-[#151d2d] pt-1">
                <span>Total Required:</span>
                <span
                  className={cn(
                    'font-mono font-semibold',
                    isBalanceSufficient ? 'text-slate-200' : 'text-rose-400'
                  )}
                >
                  {formatCurrency(totalRequiredUSDT)}
                </span>
              </div>
            ) : (
              <div className="flex justify-between text-slate-400 border-t border-[#151d2d] pt-1">
                <span>Est. Net Proceeds:</span>
                <span className="font-mono font-semibold text-emerald-300">
                  {formatCurrency(Math.max(0, orderValue - estimatedFee))}
                </span>
              </div>
            )}
            <div className="flex justify-between border-t border-[#182030] pt-1 text-slate-400">
              <span>{orderSide === 'buy' ? 'Available Balance:' : 'Available Holding:'}</span>
              <span className="font-mono text-emerald-400 font-semibold">
                {orderSide === 'buy'
                  ? `${formatCurrency(availableUsdt)} USDT`
                  : `${availableHolding.toFixed(4)} ${selectedTicker.baseAsset}`}
              </span>
            </div>
          </div>

          {/* Validation alert if balance insufficient */}
          {isQuantityValid && !isBalanceSufficient && (
            <div className="flex items-center gap-1.5 text-[10px] text-rose-400 bg-rose-950/20 border border-rose-900/30 rounded p-1.5">
              <AlertCircle className="h-3 w-3 shrink-0" />
              <span>
                {orderSide === 'buy'
                  ? 'Total cost exceeds available paper balance.'
                  : `Order amount exceeds available ${selectedTicker.baseAsset} holdings.`}
              </span>
            </div>
          )}
        </>
      )}

      {/* ======================================================== */}
      {/* 2. STOP-LOSS & TAKE-PROFIT PROTECTIVE FORM */}
      {/* ======================================================== */}
      {orderType === 'tpsl' && (
        <div className="space-y-2.5">
          {/* Position & Holding Overview */}
          <div className="rounded bg-[#070a10] p-2 border border-[#161d2d] text-[11px] space-y-1 font-mono">
            <div className="flex justify-between text-slate-400">
              <span>Total Position Held:</span>
              <span className="text-white font-medium">
                {currentPosition ? currentPosition.quantity.toFixed(4) : '0.0000'} {selectedTicker.baseAsset}
              </span>
            </div>
            <div className="flex justify-between text-slate-400">
              <span>Available to Protect:</span>
              <span className="text-emerald-400 font-semibold">
                {availableHolding.toFixed(4)} {selectedTicker.baseAsset}
              </span>
            </div>
            {currentPosition && currentPosition.reservedQuantity > 0 && (
              <div className="flex justify-between text-slate-500 text-[10px]">
                <span>Locked in Other Orders:</span>
                <span className="text-amber-400/80">
                  {currentPosition.reservedQuantity.toFixed(4)} {selectedTicker.baseAsset}
                </span>
              </div>
            )}
          </div>

          {/* Protected Quantity Input */}
          <div className="space-y-1">
            <div className="flex justify-between text-[11px] text-slate-400">
              <span>Protected Quantity</span>
              <span className="font-mono text-slate-500">{selectedTicker.baseAsset}</span>
            </div>
            <Input
              type="number"
              mono
              aria-label="Protected Quantity"
              data-testid="protective-amount-input"
              value={protectiveAmount}
              onChange={(e) => setProtectiveAmount(e.target.value)}
              placeholder="0.0000"
              min="0"
              step="any"
            />
            {/* Percentage Presets */}
            <div className="grid grid-cols-4 gap-1 pt-0.5">
              {[25, 50, 75, 100].map((pct) => (
                <Button
                  key={pct}
                  variant="outline"
                  size="sm"
                  className="h-6 text-[10px] font-mono text-slate-400 border-[#1a2334] hover:text-white hover:bg-[#151c2a]"
                  onClick={() => handleProtectivePreset(pct)}
                >
                  {pct}%
                </Button>
              ))}
            </div>
          </div>

          {/* Take-Profit Configuration Card */}
          <div className="rounded bg-[#070a10] border border-[#161d2d] p-2 space-y-1.5">
            <div className="flex items-center justify-between text-xs">
              <label className="flex items-center gap-1.5 cursor-pointer text-slate-300 font-medium text-[11px]">
                <input
                  type="checkbox"
                  checked={enableTp}
                  onChange={(e) => setEnableTp(e.target.checked)}
                  className="accent-emerald-500 rounded"
                />
                <span className="text-emerald-400 flex items-center gap-1">
                  <TrendingUp className="h-3 w-3" /> Take-Profit (Trigger &gt; Bid)
                </span>
              </label>
              <span className="text-[10px] font-mono text-slate-500">Sell High</span>
            </div>

            {enableTp && (
              <div className="space-y-1">
                <Input
                  type="number"
                  mono
                  aria-label="Take-Profit Price"
                  data-testid="tp-price-input"
                  value={tpPrice}
                  onChange={(e) => setTpPrice(e.target.value)}
                  placeholder={`> $${bestBid > 0 ? bestBid.toFixed(2) : '0.00'}`}
                  min="0"
                  step="any"
                />
                <div className="grid grid-cols-4 gap-1">
                  {[2, 5, 10, 20].map((pct) => (
                    <button
                      key={pct}
                      type="button"
                      onClick={() => handleTpPreset(pct)}
                      className="h-5 text-[9px] font-mono rounded bg-emerald-950/30 text-emerald-300 border border-emerald-900/40 hover:bg-emerald-900/50 transition-colors"
                    >
                      +{pct}%
                    </button>
                  ))}
                </div>
                {numTp && numTp > 0 && protQuantity > 0 && (
                  <div className="text-[10px] font-mono flex justify-between text-slate-400 pt-0.5">
                    <span>Est. Gross Proceeds:</span>
                    <span className="text-emerald-400 font-semibold">
                      {formatCurrency(numTp * protQuantity)}
                    </span>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Stop-Loss Configuration Card */}
          <div className="rounded bg-[#070a10] border border-[#161d2d] p-2 space-y-1.5">
            <div className="flex items-center justify-between text-xs">
              <label className="flex items-center gap-1.5 cursor-pointer text-slate-300 font-medium text-[11px]">
                <input
                  type="checkbox"
                  checked={enableSl}
                  onChange={(e) => setEnableSl(e.target.checked)}
                  className="accent-rose-500 rounded"
                />
                <span className="text-rose-400 flex items-center gap-1">
                  <TrendingDown className="h-3 w-3" /> Stop-Loss (Trigger &lt; Bid)
                </span>
              </label>
              <span className="text-[10px] font-mono text-slate-500">Limit Risk</span>
            </div>

            {enableSl && (
              <div className="space-y-1">
                <Input
                  type="number"
                  mono
                  aria-label="Stop-Loss Price"
                  data-testid="sl-price-input"
                  value={slPrice}
                  onChange={(e) => setSlPrice(e.target.value)}
                  placeholder={`< $${bestBid > 0 ? bestBid.toFixed(2) : '0.00'}`}
                  min="0"
                  step="any"
                />
                <div className="grid grid-cols-4 gap-1">
                  {[2, 5, 10, 20].map((pct) => (
                    <button
                      key={pct}
                      type="button"
                      onClick={() => handleSlPreset(pct)}
                      className="h-5 text-[9px] font-mono rounded bg-rose-950/30 text-rose-300 border border-rose-900/40 hover:bg-rose-900/50 transition-colors"
                    >
                      -{pct}%
                    </button>
                  ))}
                </div>
                {numSl && numSl > 0 && protQuantity > 0 && (
                  <div className="text-[10px] font-mono flex justify-between text-slate-400 pt-0.5">
                    <span>Est. Floor Proceeds:</span>
                    <span className="text-slate-300 font-semibold">
                      {formatCurrency(numSl * protQuantity)}
                    </span>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Protective relationship description */}
          <div className="text-[10px] text-slate-500 bg-[#090d16] p-2 rounded border border-[#161d2d] leading-tight space-y-0.5">
            <div className="flex items-center gap-1 text-slate-400 font-medium">
              <Info className="h-3 w-3 text-cyan-400 shrink-0" />
              <span>
                {enableSl && enableTp
                  ? 'Linked OCO Protection: Protected quantity is reserved once. Filling either trigger immediately cancels the other.'
                  : 'Standalone Protection: Automatically submits simulated market sell when trigger price is reached on live bid.'}
              </span>
            </div>
            <div className="text-slate-500 font-mono text-[9px]">
              Simulated execution fee: 0.05% at fill time.
            </div>
          </div>

          {/* Active Protections for this symbol */}
          {activeProtections.length > 0 && (
            <div className="space-y-1 pt-1 border-t border-[#182030]">
              <div className="text-[10px] text-slate-400 uppercase tracking-wider font-semibold flex items-center justify-between">
                <span>Active Protection ({activeProtections.length})</span>
                <span className="text-[9px] text-slate-500 font-mono">Locks {selectedTicker.baseAsset}</span>
              </div>
              <div className="space-y-1 max-h-32 overflow-y-auto pr-1">
                {activeProtections.map((p) => {
                  const isSl = p.triggerType === 'stop-loss';
                  const distance =
                    bestBid > 0 ? ((p.triggerPrice - bestBid) / bestBid) * 100 : 0;

                  return (
                    <div
                      key={p.id}
                      className="flex items-center justify-between bg-[#080c14] border border-[#182030] rounded p-1.5 text-[10px] font-mono"
                    >
                      <div className="flex items-center gap-1.5">
                        <Badge
                          variant={isSl ? 'sell' : 'buy'}
                          className="text-[8px] px-1 py-0 uppercase"
                        >
                          {isSl ? 'Stop-Loss' : 'Take-Profit'}
                        </Badge>
                        <span className="text-white font-bold">
                          {formatCurrency(p.triggerPrice)}
                        </span>
                        <span className={cn('text-[9px]', distance >= 0 ? 'text-emerald-400' : 'text-rose-400')}>
                          ({distance >= 0 ? '+' : ''}{distance.toFixed(1)}%)
                        </span>
                      </div>
                      <div className="flex items-center gap-1.5">
                        <span className="text-slate-400">{p.quantity} {p.baseAsset}</span>
                        <button
                          type="button"
                          onClick={() => cancelProtectiveOrder(p.id)}
                          className="h-4 w-4 rounded bg-[#161d2d] text-slate-400 hover:text-rose-300 hover:bg-rose-950 flex items-center justify-center transition-colors"
                          title="Cancel protection"
                          data-testid="cancel-protective-btn"
                        >
                          <X className="h-2.5 w-2.5" />
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Execute Simulated Order / Protection CTA */}
      <Button
        variant={orderType === 'tpsl' ? 'sell' : orderSide === 'buy' ? 'buy' : 'sell'}
        disabled={!canSubmit}
        className={cn(
          'w-full h-9 text-xs font-bold gap-1.5',
          orderType === 'tpsl' && canSubmit && 'bg-purple-600 hover:bg-purple-500 text-white shadow-purple-950'
        )}
        onClick={handleOrderSubmit}
        data-testid={orderType === 'tpsl' ? 'activate-protection-btn' : 'submit-order-btn'}
      >
        {isSubmitting && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
        {orderType === 'tpsl' && !isSubmitting && <ShieldCheck className="h-3.5 w-3.5" />}
        {getSubmitButtonLabel()}
      </Button>
    </div>
  );
}
