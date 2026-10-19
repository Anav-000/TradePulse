import { describe, it, expect } from 'vitest';
import {
  timeframeToBinanceInterval,
  isValidCandle,
  normalizeBinanceKlines,
} from './candleNormalizer';

describe('candleNormalizer', () => {
  describe('timeframeToBinanceInterval', () => {
    it('correctly maps all application timeframes to exchange intervals', () => {
      expect(timeframeToBinanceInterval('1m')).toBe('1m');
      expect(timeframeToBinanceInterval('5m')).toBe('5m');
      expect(timeframeToBinanceInterval('15m')).toBe('15m');
      expect(timeframeToBinanceInterval('1h')).toBe('1h');
      expect(timeframeToBinanceInterval('4h')).toBe('4h');
      expect(timeframeToBinanceInterval('1D')).toBe('1d');
      expect(timeframeToBinanceInterval('1W')).toBe('1w');
    });
  });

  describe('isValidCandle', () => {
    it('validates a normal bullish and bearish candle', () => {
      expect(
        isValidCandle({
          time: 1700000000,
          open: 100,
          high: 110,
          low: 95,
          close: 105,
          volume: 500,
        })
      ).toBe(true);

      expect(
        isValidCandle({
          time: 1700000000,
          open: 105,
          high: 110,
          low: 95,
          close: 100,
          volume: 500,
        })
      ).toBe(true);
    });

    it('rejects candle with invalid timestamps or missing values', () => {
      expect(
        isValidCandle({
          time: -1,
          open: 100,
          high: 110,
          low: 95,
          close: 105,
          volume: 10,
        })
      ).toBe(false);

      expect(
        isValidCandle({
          time: NaN,
          open: 100,
          high: 110,
          low: 95,
          close: 105,
          volume: 10,
        })
      ).toBe(false);

      expect(
        isValidCandle({
          time: 1700000000,
          open: 0, // 0 is invalid for crypto price
          high: 110,
          low: 95,
          close: 105,
          volume: 10,
        })
      ).toBe(false);
    });

    it('rejects candle when high < low or high < max(open, close)', () => {
      // High < Low
      expect(
        isValidCandle({
          time: 1700000000,
          open: 100,
          high: 80,
          low: 95,
          close: 98,
          volume: 10,
        })
      ).toBe(false);

      // High < Open
      expect(
        isValidCandle({
          time: 1700000000,
          open: 120,
          high: 110,
          low: 95,
          close: 105,
          volume: 10,
        })
      ).toBe(false);

      // Low > Close
      expect(
        isValidCandle({
          time: 1700000000,
          open: 105,
          high: 110,
          low: 102,
          close: 95,
          volume: 10,
        })
      ).toBe(false);
    });

    it('rejects candle with negative volume', () => {
      expect(
        isValidCandle({
          time: 1700000000,
          open: 100,
          high: 110,
          low: 95,
          close: 105,
          volume: -5,
        })
      ).toBe(false);
    });
  });

  describe('normalizeBinanceKlines', () => {
    it('transforms raw string arrays into typed numbers and converts milliseconds to seconds', () => {
      const rawData = [
        [1700000000000, '65000.50', '65500.00', '64800.00', '65200.00', '120.45', 1700003599999],
        [1700003600000, '65200.00', '65800.00', '65100.00', '65750.00', '98.20', 1700007199999],
      ];

      const result = normalizeBinanceKlines(rawData);

      expect(result).toHaveLength(2);
      expect(result[0]).toEqual({
        time: 1700000000, // in seconds
        open: 65000.5,
        high: 65500,
        low: 64800,
        close: 65200,
        volume: 120.45,
      });
      expect(result[1].time).toBe(1700003600);
    });

    it('handles out-of-order candles and sorts them strictly ascending', () => {
      const rawData = [
        [1700007200000, '65750.00', '66000.00', '65600.00', '65900.00', '80.00'],
        [1700000000000, '65000.00', '65500.00', '64800.00', '65200.00', '120.00'],
        [1700003600000, '65200.00', '65800.00', '65100.00', '65100.00', '90.00'],
      ];

      const result = normalizeBinanceKlines(rawData);

      expect(result).toHaveLength(3);
      expect(result[0].time).toBe(1700000000);
      expect(result[1].time).toBe(1700003600);
      expect(result[2].time).toBe(1700007200);
    });

    it('filters out corrupted rows', () => {
      const rawData = [
        [1700000000000, '65000.00', '65500.00', '64800.00', '65200.00', '100.00'],
        ['corrupt', 'nan', 'nan', 'nan', 'nan', 'nan'],
        [1700003600000, '65200.00', '63000.00', '66000.00', '65100.00', '90.00'], // High < Low, corrupt
        [1700007200000, '65750.00', '66000.00', '65600.00', '65900.00', '80.00'],
      ];

      const result = normalizeBinanceKlines(rawData);

      expect(result).toHaveLength(2);
      expect(result[0].time).toBe(1700000000);
      expect(result[1].time).toBe(1700007200);
    });

    it('deduplicates timestamps to guarantee strict monotonically increasing series', () => {
      const rawData = [
        [1700000000000, '65000.00', '65500.00', '64800.00', '65200.00', '100.00'],
        // Duplicate timestamp with updated close:
        [1700000000000, '65000.00', '65600.00', '64800.00', '65350.00', '150.00'],
        [1700003600000, '65350.00', '65800.00', '65200.00', '65700.00', '80.00'],
      ];

      const result = normalizeBinanceKlines(rawData);

      expect(result).toHaveLength(2);
      expect(result[0].time).toBe(1700000000);
      expect(result[0].close).toBe(65350); // Kept latest updated duplicate
      expect(result[1].time).toBe(1700003600);
    });

    it('returns empty array when input is empty or invalid', () => {
      expect(normalizeBinanceKlines([])).toEqual([]);
      // @ts-expect-error test non-array
      expect(normalizeBinanceKlines(null)).toEqual([]);
    });
  });
});
