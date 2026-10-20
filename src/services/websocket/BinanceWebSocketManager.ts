import { ConnectionStatus, OrderBookData, TimeFrame } from '@/types/market';
import { timeframeToBinanceInterval } from '@/services/api/candleNormalizer';
import {
  NormalizedTickerUpdate,
  NormalizedKlineUpdate,
  BinanceCombinedWrapper,
  BookQuote,
} from './types';
import {
  normalizeTickerMessage,
  normalizeKlineMessage,
  normalizeDepthMessage,
} from './wsNormalizer';

export const SUPPORTED_SYMBOLS = [
  'BTCUSDT',
  'ETHUSDT',
  'SOLUSDT',
  'BNBUSDT',
  'XRPUSDT',
  'AVAXUSDT',
  'LINKUSDT',
  'NEARUSDT',
];

type StatusListener = (status: ConnectionStatus, latencyMs: number) => void;
type TickerBatchListener = (batch: Record<string, NormalizedTickerUpdate>) => void;
type KlineListener = (kline: NormalizedKlineUpdate) => void;
type DepthListener = (depth: OrderBookData) => void;

export type { BookQuote };
type BookTickerListener = (quote: BookQuote) => void;

interface ManagerOptions {
  primaryUrl?: string;
  fallbackUrl?: string;
  batchIntervalMs?: number;
}

export class BinanceWebSocketManager {
  private static instance: BinanceWebSocketManager | null = null;

  private primaryUrl: string;
  private fallbackUrl: string;
  private currentUrlIndex: number = 0;
  private ws: WebSocket | null = null;

  private activeSymbol: string = 'BTCUSDT';
  private activeTimeFrame: TimeFrame = '1h';

  private status: ConnectionStatus = 'disconnected';
  private latencyMs: number = 24;
  private lastMessageTime: number = 0;
  private connectionStartTime: number = 0;

  private reconnectAttempts: number = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private isIntentionallyClosed: boolean = false;

  // Throttled batching
  private pendingTickers: Map<string, NormalizedTickerUpdate> = new Map();
  private batchFlushTimer: ReturnType<typeof setInterval> | null = null;
  private batchIntervalMs: number;

  // Throttled depth
  private lastDepthUpdate: OrderBookData | null = null;
  private depthFlushTimer: ReturnType<typeof setInterval> | null = null;

  // Subscriptions & Request ID
  private requestId: number = 1;
  private activeSubscriptions: Set<string> = new Set();

  // Listeners
  private statusListeners: Set<StatusListener> = new Set();
  private tickerBatchListeners: Set<TickerBatchListener> = new Set();
  private klineListeners: Set<KlineListener> = new Set();
  private depthListeners: Set<DepthListener> = new Set();
  private bookTickerListeners: Set<BookTickerListener> = new Set();
  private latestBookQuotes: Map<string, BookQuote> = new Map();

  private constructor(options?: ManagerOptions) {
    this.primaryUrl = options?.primaryUrl || 'wss://stream.binance.com/ws';
    this.fallbackUrl = options?.fallbackUrl || 'wss://data-stream.binance.vision/ws';
    this.batchIntervalMs = options?.batchIntervalMs || 150;

    this.setupWindowListeners();
  }

  public static getInstance(options?: ManagerOptions): BinanceWebSocketManager {
    if (!BinanceWebSocketManager.instance) {
      BinanceWebSocketManager.instance = new BinanceWebSocketManager(options);
    }
    return BinanceWebSocketManager.instance;
  }

  /**
   * Connects to the WebSocket feed.
   */
  public connect(): void {
    if (this.ws && (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)) {
      return;
    }

    this.isIntentionallyClosed = false;
    this.clearTimers();
    this.setStatus('connecting', 0);

    const endpoints = [this.primaryUrl, this.fallbackUrl];
    const url = endpoints[this.currentUrlIndex % endpoints.length];

    try {
      this.connectionStartTime = Date.now();
      this.ws = new WebSocket(url);
      this.ws.onopen = this.handleOpen.bind(this);
      this.ws.onmessage = this.handleMessage.bind(this);
      this.ws.onerror = this.handleError.bind(this);
      this.ws.onclose = this.handleClose.bind(this);

      this.startHeartbeatMonitor();
      this.startBatchFlush();
    } catch {
      this.scheduleReconnect();
    }
  }

  /**
   * Disconnects the WebSocket intentionally.
   */
  public disconnect(): void {
    this.isIntentionallyClosed = true;
    this.clearTimers();

    if (this.ws) {
      this.ws.onopen = null;
      this.ws.onmessage = null;
      this.ws.onerror = null;
      this.ws.onclose = null;
      this.ws.close();
      this.ws = null;
    }

    this.activeSubscriptions.clear();
    this.setStatus('disconnected', 0);
  }

  /**
   * Updates the active pair and timeframe subscription.
   * Cleans up all obsolete kline and depth streams to prevent duplicate or orphaned subscriptions.
   */
  public setActiveSubscription(symbol: string, timeFrame: TimeFrame): void {
    this.activeSymbol = symbol.toUpperCase();
    this.activeTimeFrame = timeFrame;

    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      return;
    }

    const newKline = `${this.activeSymbol.toLowerCase()}@kline_${timeframeToBinanceInterval(this.activeTimeFrame)}`;
    const newDepth = `${this.activeSymbol.toLowerCase()}@depth20@100ms`;

    // 1. Identify and remove any obsolete kline or depth subscriptions
    const toUnsubscribe: string[] = [];
    this.activeSubscriptions.forEach((sub) => {
      if (sub.includes('@depth') && sub !== newDepth) {
        toUnsubscribe.push(sub);
      }
      if (sub.includes('@kline_') && sub !== newKline) {
        toUnsubscribe.push(sub);
      }
    });

    toUnsubscribe.forEach((sub) => this.activeSubscriptions.delete(sub));

    if (toUnsubscribe.length > 0) {
      this.sendRpc('UNSUBSCRIBE', toUnsubscribe);
    }

    // 2. Subscribe new pair streams if not already active
    const toSubscribe: string[] = [];
    if (!this.activeSubscriptions.has(newKline)) {
      toSubscribe.push(newKline);
      this.activeSubscriptions.add(newKline);
    }
    if (!this.activeSubscriptions.has(newDepth)) {
      toSubscribe.push(newDepth);
      this.activeSubscriptions.add(newDepth);
    }

    if (toSubscribe.length > 0) {
      this.sendRpc('SUBSCRIBE', toSubscribe);
    }
  }

  /**
   * Returns a copy of the currently active subscription streams.
   */
  public getActiveSubscriptions(): string[] {
    return Array.from(this.activeSubscriptions);
  }

  /**
   * Registers a listener for real-time best bid/ask bookTicker quotes across all symbols.
   */
  public subscribeBookTicker(listener: BookTickerListener): () => void {
    this.bookTickerListeners.add(listener);
    return () => {
      this.bookTickerListeners.delete(listener);
    };
  }

  /**
   * Retrieves latest live Best Ask & Best Bid quote for a given symbol.
   */
  public getLatestBookQuote(symbol: string): BookQuote | undefined {
    return this.latestBookQuotes.get(symbol.toUpperCase());
  }

  /**
   * Returns all current best bid/ask quotes.
   */
  public getAllBookQuotes(): Record<string, BookQuote> {
    const res: Record<string, BookQuote> = {};
    this.latestBookQuotes.forEach((v, k) => {
      res[k] = v;
    });
    return res;
  }

  /**
   * Ingests book quotes (e.g. from REST ticker hydration or fallback polling)
   * to ensure order matching is continuously supported even if WebSocket degrades.
   */
  public ingestBookQuotes(quotes: Record<string, BookQuote>): void {
    for (const [sym, quote] of Object.entries(quotes)) {
      this.latestBookQuotes.set(sym.toUpperCase(), quote);
      this.bookTickerListeners.forEach((listener) => listener(quote));
    }
  }

  private handleOpen(): void {
    this.reconnectAttempts = 0;
    this.lastMessageTime = Date.now();
    this.latencyMs = Math.max(1, Date.now() - this.connectionStartTime);
    this.setStatus('connected', this.latencyMs);

    // Subscribe to all 8 tickers, bookTickers + active pair kline & depth
    const tickerStreams = SUPPORTED_SYMBOLS.map((s) => `${s.toLowerCase()}@ticker`);
    const bookTickerStreams = SUPPORTED_SYMBOLS.map((s) => `${s.toLowerCase()}@bookTicker`);
    const activeKline = `${this.activeSymbol.toLowerCase()}@kline_${timeframeToBinanceInterval(this.activeTimeFrame)}`;
    const activeDepth = `${this.activeSymbol.toLowerCase()}@depth20@100ms`;

    const allStreams = [...tickerStreams, ...bookTickerStreams, activeKline, activeDepth];
    this.activeSubscriptions = new Set(allStreams);

    this.sendRpc('SUBSCRIBE', allStreams);
  }

  private handleMessage(event: MessageEvent): void {
    this.lastMessageTime = Date.now();
    if (this.status !== 'connected') {
      this.setStatus('connected', this.latencyMs);
    }

    try {
      const raw = JSON.parse(event.data);

      // Handle combined stream wrapper or direct message
      const payload = (raw as BinanceCombinedWrapper).data || raw;
      if (!payload || typeof payload !== 'object') return;

      const eventType = payload.e;

      // 1. 24hrTicker
      if (eventType === '24hrTicker') {
        const ticker = normalizeTickerMessage(payload);
        if (ticker) {
          this.pendingTickers.set(ticker.symbol, ticker);
        }
        return;
      }

      // 2. Kline
      if (eventType === 'kline') {
        const kline = normalizeKlineMessage(payload);
        if (kline && kline.symbol === this.activeSymbol) {
          this.klineListeners.forEach((listener) => listener(kline));
        }
        return;
      }

      // 3. Partial Depth (bids and asks present)
      if (Array.isArray(payload.bids) && Array.isArray(payload.asks)) {
        // Find matching symbol from stream name or default to active
        const streamName = (raw as BinanceCombinedWrapper).stream || '';
        let depthSymbol = this.activeSymbol;
        for (const s of SUPPORTED_SYMBOLS) {
          if (streamName.startsWith(s.toLowerCase())) {
            depthSymbol = s;
            break;
          }
        }

        const depth = normalizeDepthMessage(payload, depthSymbol);
        if (depth && depth.symbol === this.activeSymbol) {
          this.lastDepthUpdate = depth;
        }
        return;
      }

      // 4. Real-time Best Bid & Ask BookTicker (for all supported symbols)
      const isBookTicker =
        (payload as any).u !== undefined &&
        (payload as any).s &&
        (payload as any).b !== undefined &&
        (payload as any).a !== undefined;

      if (isBookTicker) {
        const sym = String((payload as any).s).toUpperCase();
        const bidPrice = parseFloat((payload as any).b) || 0;
        const askPrice = parseFloat((payload as any).a) || 0;

        if (bidPrice > 0 && askPrice > 0) {
          const quote: BookQuote = {
            symbol: sym,
            bidPrice,
            askPrice,
            lastPrice: (bidPrice + askPrice) / 2,
            timestamp: Date.now(),
          };
          this.latestBookQuotes.set(sym, quote);
          this.bookTickerListeners.forEach((listener) => listener(quote));
        }
        return;
      }
    } catch {
      // Ignore malformed JSON payloads
    }
  }

  private handleError(): void {
    if (this.status === 'connected') {
      this.setStatus('stale', this.latencyMs);
    }
  }

  private handleClose(): void {
    if (this.isIntentionallyClosed) return;

    this.currentUrlIndex++; // alternate endpoints
    this.setStatus('disconnected', 0);
    this.scheduleReconnect();
  }

  private scheduleReconnect(): void {
    if (this.isIntentionallyClosed || this.reconnectTimer) return;

    this.reconnectAttempts++;
    // Exponential backoff with jitter: 1s, 2s, 4s, 8s, up to 15s max
    const baseDelay = Math.min(15000, 1000 * Math.pow(1.5, this.reconnectAttempts));
    const jitter = Math.random() * 500;
    const delay = Math.round(baseDelay + jitter);

    this.setStatus('connecting', 0);

    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, delay);
  }

  private sendRpc(method: 'SUBSCRIBE' | 'UNSUBSCRIBE', params: string[]): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN || params.length === 0) {
      return;
    }

    try {
      const msg = {
        method,
        params,
        id: this.requestId++,
      };
      this.ws.send(JSON.stringify(msg));
    } catch {
      // Ignored if socket closing
    }
  }

  private startHeartbeatMonitor(): void {
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);

    this.heartbeatTimer = setInterval(() => {
      if (this.isIntentionallyClosed || !this.ws) return;

      const elapsed = Date.now() - this.lastMessageTime;
      if (this.lastMessageTime > 0 && elapsed > 10000 && this.status === 'connected') {
        this.setStatus('stale', this.latencyMs);
      }

      // If no messages for > 25 seconds, reconnect
      if (this.lastMessageTime > 0 && elapsed > 25000) {
        this.ws.close();
      }
    }, 3000);
  }

  private startBatchFlush(): void {
    if (this.batchFlushTimer) clearInterval(this.batchFlushTimer);

    this.batchFlushTimer = setInterval(() => {
      if (this.pendingTickers.size === 0) return;

      const batch: Record<string, NormalizedTickerUpdate> = {};
      this.pendingTickers.forEach((val, key) => {
        batch[key] = val;
      });
      this.pendingTickers.clear();

      this.tickerBatchListeners.forEach((listener) => listener(batch));
    }, this.batchIntervalMs);

    // Depth flush throttled to 100ms
    if (this.depthFlushTimer) clearInterval(this.depthFlushTimer);
    this.depthFlushTimer = setInterval(() => {
      if (this.lastDepthUpdate) {
        const update = this.lastDepthUpdate;
        this.lastDepthUpdate = null;
        this.depthListeners.forEach((listener) => listener(update));
      }
    }, 100);
  }

  private setupWindowListeners(): void {
    if (typeof window === 'undefined') return;

    window.addEventListener('online', () => {
      if (this.status !== 'connected') {
        this.connect();
      }
    });

    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible' && this.status !== 'connected') {
        this.connect();
      }
    });
  }

  private clearTimers(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
    if (this.batchFlushTimer) {
      clearInterval(this.batchFlushTimer);
      this.batchFlushTimer = null;
    }
    if (this.depthFlushTimer) {
      clearInterval(this.depthFlushTimer);
      this.depthFlushTimer = null;
    }
  }

  private setStatus(status: ConnectionStatus, latencyMs: number): void {
    this.status = status;
    this.latencyMs = latencyMs;
    this.statusListeners.forEach((l) => l(status, latencyMs));
  }

  // Listener subscriptions
  public subscribeStatus(listener: StatusListener): () => void {
    this.statusListeners.add(listener);
    listener(this.status, this.latencyMs);
    return () => this.statusListeners.delete(listener);
  }

  public subscribeTickerBatch(listener: TickerBatchListener): () => void {
    this.tickerBatchListeners.add(listener);
    return () => this.tickerBatchListeners.delete(listener);
  }

  public subscribeKline(listener: KlineListener): () => void {
    this.klineListeners.add(listener);
    return () => this.klineListeners.delete(listener);
  }

  public subscribeDepth(listener: DepthListener): () => void {
    this.depthListeners.add(listener);
    return () => this.depthListeners.delete(listener);
  }

  public getStatus(): ConnectionStatus {
    return this.status;
  }

  public getLatency(): number {
    return this.latencyMs;
  }
}

export const wsManager = BinanceWebSocketManager.getInstance();
