import { describe, it, expect } from 'vitest';
import { BinanceWebSocketManager } from './BinanceWebSocketManager';

describe('BinanceWebSocketManager', () => {
  it('maintains a singleton instance', () => {
    const instanceA = BinanceWebSocketManager.getInstance();
    const instanceB = BinanceWebSocketManager.getInstance();
    expect(instanceA).toBe(instanceB);
  });

  it('allows registering and unregistering status listeners', () => {
    const manager = BinanceWebSocketManager.getInstance();
    let receivedStatus = '';

    const unsubscribe = manager.subscribeStatus((status) => {
      receivedStatus = status;
    });

    expect(receivedStatus).toBe(manager.getStatus());
    unsubscribe();
  });

  it('allows registering and unregistering kline listeners', () => {
    const manager = BinanceWebSocketManager.getInstance();
    const handler = () => {};

    const unsubscribe = manager.subscribeKline(handler);
    expect(typeof unsubscribe).toBe('function');
    unsubscribe();
  });

  it('allows registering and unregistering depth listeners', () => {
    const manager = BinanceWebSocketManager.getInstance();
    const handler = () => {};

    const unsubscribe = manager.subscribeDepth(handler);
    expect(typeof unsubscribe).toBe('function');
    unsubscribe();
  });

  it('updates active subscription and provides active stream list', () => {
    const manager = BinanceWebSocketManager.getInstance();
    expect(() => {
      manager.setActiveSubscription('ETHUSDT', '15m');
      manager.setActiveSubscription('SOLUSDT', '4h');
    }).not.toThrow();

    const activeSubs = manager.getActiveSubscriptions();
    expect(Array.isArray(activeSubs)).toBe(true);
  });

  it('ingests book quotes and notifies bookTicker subscribers', () => {
    const manager = BinanceWebSocketManager.getInstance();
    const receivedQuotes: any[] = [];

    const unsubscribe = manager.subscribeBookTicker((q) => {
      receivedQuotes.push(q);
    });

    manager.ingestBookQuotes({
      BTCUSDT: {
        symbol: 'BTCUSDT',
        bidPrice: 82100.0,
        askPrice: 82100.5,
        lastPrice: 82100.25,
        timestamp: 1729400000000,
      },
    });

    expect(receivedQuotes.length).toBe(1);
    expect(receivedQuotes[0].symbol).toBe('BTCUSDT');
    expect(receivedQuotes[0].bidPrice).toBe(82100.0);

    const latest = manager.getLatestBookQuote('BTCUSDT');
    expect(latest?.askPrice).toBe(82100.5);

    unsubscribe();
  });
});
