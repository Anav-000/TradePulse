import { describe, it, expect } from 'vitest';
import {
  normalizeTickerMessage,
  normalizeKlineMessage,
  normalizeDepthMessage,
} from './wsNormalizer';

describe('wsNormalizer', () => {
  describe('normalizeTickerMessage', () => {
    it('normalizes valid 24hrTicker payload accurately', () => {
      const raw = {
        e: '24hrTicker',
        E: 1700000000000,
        s: 'BTCUSDT',
        p: '1500.50',
        P: '2.35',
        c: '68500.00',
        h: '69000.00',
        l: '66500.00',
        v: '45000.5',
        q: '3082500000.0',
      };

      const result = normalizeTickerMessage(raw);

      expect(result).not.toBeNull();
      expect(result).toEqual({
        symbol: 'BTCUSDT',
        lastPrice: 68500,
        priceChange24h: 1500.5,
        priceChangePercent24h: 2.35,
        high24h: 69000,
        low24h: 66500,
        volume24h: 45000.5,
        quoteVolume24h: 3082500000,
        timestamp: 1700000000000,
      });
    });

    it('rejects payloads with wrong event type or missing symbol', () => {
      expect(normalizeTickerMessage({ e: 'trade', s: 'BTCUSDT' })).toBeNull();
      expect(normalizeTickerMessage({ e: '24hrTicker', s: '' })).toBeNull();
      expect(normalizeTickerMessage(null)).toBeNull();
      expect(normalizeTickerMessage('invalid string')).toBeNull();
    });

    it('rejects invalid or non-finite price values', () => {
      expect(
        normalizeTickerMessage({
          e: '24hrTicker',
          s: 'BTCUSDT',
          c: '0', // zero price is invalid
          p: '0',
          P: '0',
        })
      ).toBeNull();

      expect(
        normalizeTickerMessage({
          e: '24hrTicker',
          s: 'BTCUSDT',
          c: 'NaN',
          p: '0',
          P: '0',
        })
      ).toBeNull();
    });
  });

  describe('normalizeKlineMessage', () => {
    it('normalizes valid kline payload and converts milliseconds to seconds', () => {
      const raw = {
        e: 'kline',
        E: 1700000005000,
        s: 'ETHUSDT',
        k: {
          t: 1700000000000,
          T: 1700000059999,
          s: 'ETHUSDT',
          i: '1m',
          o: '3500.00',
          c: '3520.50',
          h: '3530.00',
          l: '3495.00',
          v: '250.4',
          x: false,
        },
      };

      const result = normalizeKlineMessage(raw);

      expect(result).not.toBeNull();
      expect(result?.symbol).toBe('ETHUSDT');
      expect(result?.interval).toBe('1m');
      expect(result?.isClosed).toBe(false);
      expect(result?.candle).toEqual({
        time: 1700000000, // seconds
        open: 3500,
        high: 3530,
        low: 3495,
        close: 3520.5,
        volume: 250.4,
      });
    });

    it('rejects corrupted kline payload with high < low', () => {
      const corruptRaw = {
        e: 'kline',
        s: 'ETHUSDT',
        k: {
          t: 1700000000000,
          i: '1m',
          o: '3500.00',
          c: '3520.50',
          h: '3400.00', // high lower than open/close
          l: '3495.00',
          v: '250.4',
        },
      };

      expect(normalizeKlineMessage(corruptRaw)).toBeNull();
    });
  });

  describe('normalizeDepthMessage', () => {
    it('normalizes partial depth, sorts bids descending and asks ascending, and computes spread', () => {
      const raw = {
        lastUpdateId: 987654,
        bids: [
          ['81498.00', '1.200'],
          ['81500.00', '0.500'], // Highest bid
          ['81490.00', '3.000'],
        ],
        asks: [
          ['81505.00', '2.000'],
          ['81501.00', '0.400'], // Lowest ask
          ['81510.00', '5.000'],
        ],
      };

      const result = normalizeDepthMessage(raw, 'BTCUSDT');

      expect(result).not.toBeNull();
      expect(result?.symbol).toBe('BTCUSDT');
      expect(result?.lastUpdateId).toBe(987654);

      // Bids sorted descending
      expect(result?.bids[0].price).toBe(81500);
      expect(result?.bids[1].price).toBe(81498);
      expect(result?.bids[2].price).toBe(81490);

      // Asks sorted ascending
      expect(result?.asks[0].price).toBe(81501);
      expect(result?.asks[1].price).toBe(81505);
      expect(result?.asks[2].price).toBe(81510);

      // Spread calculation
      expect(result?.spread).toBeCloseTo(1.0, 2); // 81501 - 81500 = 1
      expect(result?.spreadPercentage).toBeGreaterThan(0);

      // Total and depth calculations
      expect(result?.bids[0].total).toBe(81500 * 0.5);
      expect(result?.bids[0].depth).toBeDefined();
    });

    it('rejects empty or malformed depth messages', () => {
      expect(normalizeDepthMessage(null, 'BTCUSDT')).toBeNull();
      expect(normalizeDepthMessage({ bids: [] }, 'BTCUSDT')).toBeNull();
      expect(normalizeDepthMessage({ bids: [], asks: [] }, 'BTCUSDT')).toBeNull();
    });
  });
});
