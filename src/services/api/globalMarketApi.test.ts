import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  fetchGlobalMarketOverview,
  fetch7DaySparklines,
} from './globalMarketApi';

describe('globalMarketApi', () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('fetches and normalizes global cryptocurrency statistics from CoinPaprika and Alternative.me', async () => {
    global.fetch = vi.fn().mockImplementation((url: string) => {
      if (url.includes('coinpaprika.com')) {
        return Promise.resolve({
          ok: true,
          json: () =>
            Promise.resolve({
              market_cap_usd: 2890000000000,
              market_cap_change_24h: 2.45,
              volume_24h_usd: 495000000000,
              bitcoin_dominance_percentage: 57.34,
            }),
        });
      }
      if (url.includes('alternative.me')) {
        return Promise.resolve({
          ok: true,
          json: () =>
            Promise.resolve({
              data: [
                {
                  value: '58',
                  value_classification: 'Greed',
                },
              ],
            }),
        });
      }
      return Promise.reject(new Error(`Unhandled URL: ${url}`));
    });

    const result = await fetchGlobalMarketOverview();

    expect(result.status).toBe('live');
    expect(result.stats.totalMarketCap).toBe(2890000000000);
    expect(result.stats.marketCapChange24h).toBe(2.45);
    expect(result.stats.totalVolume24h).toBe(495000000000);
    expect(result.stats.btcDominance).toBe(57.3);
    expect(result.stats.fearAndGreedIndex).toBe(58);
    expect(result.stats.fearAndGreedSentiment).toBe('Greed');
  });

  it('handles public API failure gracefully with unavailable status without throwing', async () => {
    global.fetch = vi.fn().mockImplementation(() =>
      Promise.resolve({
        ok: false,
        status: 503,
      })
    );

    const result = await fetchGlobalMarketOverview();

    expect(result.status).toBe('unavailable');
    expect(result.stats.totalMarketCap).toBe(0);
    expect(result.error).toBeDefined();
  });

  it('fetches genuine 7-day sparkline with 8 daily observations, sorting chronologically and deduplicating', async () => {
    // Unsorted with a duplicate timestamp
    const mockKlines = [
      [1004, '61000', '63000', '60000', '62500', '100', 1005, '6250000'],
      [1000, '58000', '60500', '57500', '60000', '100', 1001, '6000000'], // Day -7 close: 60,000
      [1002, '60000', '62000', '59000', '61000', '100', 1003, '6100000'],
      [1002, '60000', '62000', '59000', '61000', '100', 1003, '6100000'], // Duplicate
      [1006, '62500', '64000', '62000', '63000', '100', 1007, '6300000'],
      [1008, '63000', '65000', '62500', '64000', '100', 1009, '6400000'],
      [1010, '64000', '66000', '63500', '65000', '100', 1011, '6500000'],
      [1012, '65000', '67000', '64500', '66000', '100', 1013, '6600000'],
      [1014, '66000', '68000', '65500', '67200', '100', 1015, '6720000'], // Day 0 close: 67,200
    ];

    global.fetch = vi.fn().mockImplementation((url: string) => {
      expect(url).toContain('limit=8');
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve(mockKlines),
      });
    });

    const result = await fetch7DaySparklines(['BTCUSDT']);

    expect(result['BTCUSDT']).toBeDefined();
    // 8 sorted and deduplicated daily closing prices
    expect(result['BTCUSDT'].prices).toEqual([
      60000, 61000, 62500, 63000, 64000, 65000, 66000, 67200,
    ]);
    // Exactly 7 days from 60,000 to 67,200 = +12.0%
    expect(result['BTCUSDT'].changePercent7d).toBe(12);
  });
});
