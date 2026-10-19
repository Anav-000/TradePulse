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
});
