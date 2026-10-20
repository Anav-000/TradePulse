export type ConnectionStatus = 'connected' | 'connecting' | 'stale' | 'disconnected' | 'simulated';

export type TimeFrame = '1m' | '5m' | '15m' | '1h' | '4h' | '1D' | '1W';

export interface CryptoTicker {
  symbol: string;              // e.g., 'BTCUSDT'
  baseAsset: string;           // e.g., 'BTC'
  quoteAsset: string;          // e.g., 'USDT'
  name: string;                // e.g., 'Bitcoin'
  lastPrice: number;
  previousClosePrice: number;
  priceChange24h: number;
  priceChangePercent24h: number;
  high24h: number;
  low24h: number;
  volume24h: number;           // in base asset
  quoteVolume24h: number;      // in quote asset (USDT)
  sparkline7d: number[];       // array of recent sample prices for mini-charts
  isFavorite?: boolean;
  lastUpdated?: number;        // Epoch timestamp (ms) when price was last updated
  source?: 'websocket' | 'rest' | 'candle_sync' | 'mock'; // Data source origin
}

export interface MarketOverviewStats {
  totalMarketCap: number;
  marketCapChange24h: number;
  totalVolume24h: number;
  btcDominance: number;
  ethDominance: number;
  fearAndGreedIndex: number;
  fearAndGreedSentiment: 'Extreme Fear' | 'Fear' | 'Neutral' | 'Greed' | 'Extreme Greed';
}

export interface CandleStick {
  time: number; // Unix timestamp in seconds
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface OrderBookEntry {
  price: number;
  amount: number;
  total: number;
  depth?: number; // visual percentage 0-100
}

export interface OrderBookData {
  symbol: string;
  bids: OrderBookEntry[];
  asks: OrderBookEntry[];
  spread: number;
  spreadPercentage: number;
  lastUpdateId: number;
  lastUpdated: number;
}
