import { CandleStick, OrderBookData } from '@/types/market';

/**
 * Raw Binance Spot WebSocket message schemas
 */
export interface BinanceRaw24hrTicker {
  e: '24hrTicker';
  E: number; // Event time
  s: string; // Symbol
  p: string; // Price change
  P: string; // Price change percent
  w: string; // Weighted average price
  x: string; // Prev close price
  c: string; // Last price
  Q: string; // Last qty
  b: string; // Best bid
  B: string; // Best bid qty
  a: string; // Best ask
  A: string; // Best ask qty
  o: string; // Open
  h: string; // High
  l: string; // Low
  v: string; // Total traded base volume
  q: string; // Total traded quote volume
}

export interface BinanceRawKline {
  e: 'kline';
  E: number; // Event time
  s: string; // Symbol
  k: {
    t: number;  // Kline start time
    T: number;  // Kline close time
    s: string;  // Symbol
    i: string;  // Interval
    o: string;  // Open price
    c: string;  // Close price
    h: string;  // High price
    l: string;  // Low price
    v: string;  // Base volume
    n: number;  // Trade count
    x: boolean; // Is kline closed?
    q: string;  // Quote asset volume
  };
}

export interface BinanceRawPartialDepth {
  lastUpdateId: number;
  bids: [string, string][]; // [price, quantity]
  asks: [string, string][]; // [price, quantity]
}

export interface BinanceCombinedWrapper {
  stream: string;
  data: unknown;
}

/**
 * Normalized data structures used across the application
 */
export interface BookQuote {
  symbol: string;
  bidPrice: number;
  askPrice: number;
  lastPrice: number;
  timestamp: number;
}

export interface NormalizedTickerUpdate {
  symbol: string;
  lastPrice: number;
  priceChange24h: number;
  priceChangePercent24h: number;
  high24h: number;
  low24h: number;
  volume24h: number;
  quoteVolume24h: number;
  timestamp: number;
}

export interface NormalizedKlineUpdate {
  symbol: string;
  interval: string;
  candle: CandleStick;
  isClosed: boolean;
  eventTime: number;
}

export type WebSocketPayload =
  | { type: 'ticker'; payload: NormalizedTickerUpdate }
  | { type: 'kline'; payload: NormalizedKlineUpdate }
  | { type: 'depth'; payload: OrderBookData };
