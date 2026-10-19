import { OrderBookData, OrderBookEntry } from '@/types/market';
import { isValidCandle } from '@/services/api/candleNormalizer';
import {
  BinanceRaw24hrTicker,
  BinanceRawKline,
  BinanceRawPartialDepth,
  NormalizedTickerUpdate,
  NormalizedKlineUpdate,
} from './types';

/**
 * Normalizes raw Binance 24hrTicker payloads.
 */
export function normalizeTickerMessage(raw: unknown): NormalizedTickerUpdate | null {
  if (!raw || typeof raw !== 'object') return null;

  const data = raw as Partial<BinanceRaw24hrTicker>;
  if (data.e !== '24hrTicker' || !data.s) return null;

  const lastPrice = parseFloat(data.c || '0');
  const priceChange24h = parseFloat(data.p || '0');
  const priceChangePercent24h = parseFloat(data.P || '0');
  const high24h = parseFloat(data.h || '0');
  const low24h = parseFloat(data.l || '0');
  const volume24h = parseFloat(data.v || '0');
  const quoteVolume24h = parseFloat(data.q || '0');

  if (
    !Number.isFinite(lastPrice) ||
    lastPrice <= 0 ||
    !Number.isFinite(priceChangePercent24h)
  ) {
    return null;
  }

  return {
    symbol: data.s.toUpperCase(),
    lastPrice,
    priceChange24h,
    priceChangePercent24h,
    high24h,
    low24h,
    volume24h,
    quoteVolume24h,
    timestamp: data.E || Date.now(),
  };
}

/**
 * Normalizes raw Binance kline payloads.
 */
export function normalizeKlineMessage(raw: unknown): NormalizedKlineUpdate | null {
  if (!raw || typeof raw !== 'object') return null;

  const msg = raw as Partial<BinanceRawKline>;
  if (msg.e !== 'kline' || !msg.k) return null;

  const k = msg.k;
  const timeInSeconds = Math.floor((k.t || 0) / 1000);
  const open = parseFloat(k.o || '0');
  const high = parseFloat(k.h || '0');
  const low = parseFloat(k.l || '0');
  const close = parseFloat(k.c || '0');
  const volume = parseFloat(k.v || '0');

  const candle = {
    time: timeInSeconds,
    open,
    high,
    low,
    close,
    volume,
  };

  if (!isValidCandle(candle)) {
    return null;
  }

  return {
    symbol: (msg.s || k.s || '').toUpperCase(),
    interval: k.i || '',
    candle,
    isClosed: Boolean(k.x),
    eventTime: msg.E || Date.now(),
  };
}

/**
 * Normalizes raw partial depth payloads (depth10/depth20).
 */
export function normalizeDepthMessage(
  raw: unknown,
  symbol: string
): OrderBookData | null {
  if (!raw || typeof raw !== 'object') return null;

  const depth = raw as Partial<BinanceRawPartialDepth>;
  if (!Array.isArray(depth.bids) || !Array.isArray(depth.asks)) return null;

  // Process bids (descending price)
  const bids: OrderBookEntry[] = [];
  let maxBidTotal = 0;

  for (const [pStr, aStr] of depth.bids) {
    const price = parseFloat(pStr);
    const amount = parseFloat(aStr);
    if (Number.isFinite(price) && price > 0 && Number.isFinite(amount) && amount >= 0) {
      const total = price * amount;
      if (total > maxBidTotal) maxBidTotal = total;
      bids.push({ price, amount, total });
    }
  }

  bids.sort((a, b) => b.price - a.price);

  // Process asks (ascending price)
  const asks: OrderBookEntry[] = [];
  let maxAskTotal = 0;

  for (const [pStr, aStr] of depth.asks) {
    const price = parseFloat(pStr);
    const amount = parseFloat(aStr);
    if (Number.isFinite(price) && price > 0 && Number.isFinite(amount) && amount >= 0) {
      const total = price * amount;
      if (total > maxAskTotal) maxAskTotal = total;
      asks.push({ price, amount, total });
    }
  }

  asks.sort((a, b) => a.price - b.price);

  if (bids.length === 0 || asks.length === 0) return null;

  // Calculate cumulative depth visual bars (0 - 100%)
  const maxTotal = Math.max(maxBidTotal, maxAskTotal, 1);
  for (const b of bids) {
    b.depth = Math.min(100, Math.round((b.total / maxTotal) * 100));
  }
  for (const a of asks) {
    a.depth = Math.min(100, Math.round((a.total / maxTotal) * 100));
  }

  const bestBid = bids[0].price;
  const bestAsk = asks[0].price;
  const spread = Math.max(0, bestAsk - bestBid);
  const spreadPercentage = bestAsk > 0 ? (spread / bestAsk) * 100 : 0;

  return {
    symbol: symbol.toUpperCase(),
    bids,
    asks,
    spread,
    spreadPercentage,
    lastUpdateId: depth.lastUpdateId || 0,
    lastUpdated: Date.now(),
  };
}
