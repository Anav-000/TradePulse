import { describe, it, expect } from 'vitest';
import { classifyAndRankMarketTickers } from './marketRankings';
import { CryptoTicker } from '@/types/market';

function createMockTicker(symbol: string, priceChangePercent24h: number): CryptoTicker {
  return {
    symbol,
    baseAsset: symbol.replace('USDT', ''),
    quoteAsset: 'USDT',
    name: symbol,
    lastPrice: 100,
    previousClosePrice: 100,
    priceChange24h: priceChangePercent24h,
    priceChangePercent24h,
    high24h: 110,
    low24h: 90,
    volume24h: 1000,
    quoteVolume24h: 100000,
    sparkline7d: [100, 101, 102],
  };
}

describe('classifyAndRankMarketTickers', () => {
  it('1. correctly ranks when all supported assets have positive returns', () => {
    const tickers = [
      createMockTicker('BTCUSDT', 2.5),
      createMockTicker('ETHUSDT', 5.8),
      createMockTicker('SOLUSDT', 1.2),
      createMockTicker('BNBUSDT', 3.4),
    ];

    const result = classifyAndRankMarketTickers(tickers, 3);

    expect(result.topPerformers.map((t) => t.symbol)).toEqual(['ETHUSDT', 'BNBUSDT', 'BTCUSDT']);
    expect(result.bottomPerformers.map((t) => t.symbol)).toEqual(['SOLUSDT', 'BTCUSDT', 'BNBUSDT']);
    expect(result.gainers).toHaveLength(4);
    expect(result.losers).toHaveLength(0);
  });

  it('2. correctly ranks when all supported assets have negative returns (bear market)', () => {
    const tickers = [
      createMockTicker('BTCUSDT', -1.5),
      createMockTicker('ETHUSDT', -6.2),
      createMockTicker('SOLUSDT', -3.8),
      createMockTicker('BNBUSDT', -0.5),
    ];

    const result = classifyAndRankMarketTickers(tickers, 3);

    // Best relative performers among negative assets (-0.5 is best, then -1.5, then -3.8)
    expect(result.topPerformers.map((t) => t.symbol)).toEqual(['BNBUSDT', 'BTCUSDT', 'SOLUSDT']);
    // Worst performers (-6.2 is worst, then -3.8, then -1.5)
    expect(result.bottomPerformers.map((t) => t.symbol)).toEqual(['ETHUSDT', 'SOLUSDT', 'BTCUSDT']);

    // Strict gainers must be empty, strict losers has all 4
    expect(result.gainers).toHaveLength(0);
    expect(result.losers).toHaveLength(4);
    expect(result.losers[0].symbol).toBe('ETHUSDT');
  });

  it('3. correctly classifies mixed positive and negative assets without absolute value distortion', () => {
    const tickers = [
      createMockTicker('BTCUSDT', 4.0),
      createMockTicker('ETHUSDT', -7.0),
      createMockTicker('SOLUSDT', 1.5),
      createMockTicker('AVAXUSDT', -2.0),
    ];

    const result = classifyAndRankMarketTickers(tickers, 2);

    expect(result.topPerformers.map((t) => t.symbol)).toEqual(['BTCUSDT', 'SOLUSDT']);
    expect(result.bottomPerformers.map((t) => t.symbol)).toEqual(['ETHUSDT', 'AVAXUSDT']);
    expect(result.gainers.map((t) => t.symbol)).toEqual(['BTCUSDT', 'SOLUSDT']);
    expect(result.losers.map((t) => t.symbol)).toEqual(['ETHUSDT', 'AVAXUSDT']);
  });

  it('4. excludes zero-change assets from strict gainers and losers', () => {
    const tickers = [
      createMockTicker('BTCUSDT', 3.0),
      createMockTicker('ETHUSDT', 0.0),
      createMockTicker('SOLUSDT', -2.5),
    ];

    const result = classifyAndRankMarketTickers(tickers);

    expect(result.gainers.map((t) => t.symbol)).toEqual(['BTCUSDT']);
    expect(result.losers.map((t) => t.symbol)).toEqual(['SOLUSDT']);

    // Zero-change asset is included in relative performers
    expect(result.topPerformers.map((t) => t.symbol)).toEqual(['BTCUSDT', 'ETHUSDT', 'SOLUSDT']);
  });

  it('5. safely filters out missing, NaN, and non-finite percentages', () => {
    const tickers = [
      createMockTicker('BTCUSDT', 3.0),
      createMockTicker('CORRUPT1', NaN),
      createMockTicker('CORRUPT2', Infinity),
      createMockTicker('SOLUSDT', -1.0),
    ];

    const result = classifyAndRankMarketTickers(tickers);

    expect(result.topPerformers.map((t) => t.symbol)).toEqual(['BTCUSDT', 'SOLUSDT']);
    expect(result.gainers.map((t) => t.symbol)).toEqual(['BTCUSDT']);
    expect(result.losers.map((t) => t.symbol)).toEqual(['SOLUSDT']);
  });

  it('6. produces stable deterministic ordering for equal percentage changes', () => {
    const tickers = [
      createMockTicker('SOLUSDT', 2.0),
      createMockTicker('AVAXUSDT', 2.0),
      createMockTicker('BTCUSDT', 2.0),
    ];

    const result = classifyAndRankMarketTickers(tickers);

    // Alphabetical tiebreaker: AVAXUSDT < BTCUSDT < SOLUSDT
    expect(result.topPerformers.map((t) => t.symbol)).toEqual(['AVAXUSDT', 'BTCUSDT', 'SOLUSDT']);
  });
});
