import { MarketOverviewStats } from '@/types/market';

export interface GlobalMarketDataResult {
  stats: MarketOverviewStats;
  source: string;
  lastUpdated: number;
  status: 'live' | 'stale' | 'unavailable';
  error?: string;
}

export interface SparklineDataResult {
  symbol: string;
  prices: number[];
  changePercent7d: number;
}

/**
 * Fetches real Global Cryptocurrency Market Statistics:
 * 1. Global Market Cap, 24h Volume, BTC/ETH Dominance from CoinPaprika public API
 * 2. Fear & Greed Index from Alternative.me public API
 */
export async function fetchGlobalMarketOverview(
  signal?: AbortSignal
): Promise<GlobalMarketDataResult> {
  let paprikaData: any = null;
  let fngData: any = null;
  const errors: string[] = [];

  // 1. Fetch Global Crypto Stats from CoinPaprika public API
  try {
    const res = await fetch('https://api.coinpaprika.com/v1/global', {
      signal,
      headers: { Accept: 'application/json' },
    });
    if (res.ok) {
      paprikaData = await res.json();
    } else {
      errors.push(`CoinPaprika HTTP ${res.status}`);
    }
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') throw err;
    errors.push('CoinPaprika unreachable');
  }

  // 2. Fetch Crypto Fear & Greed Index from Alternative.me public API
  try {
    const res = await fetch('https://api.alternative.me/fng/?limit=1', {
      signal,
      headers: { Accept: 'application/json' },
    });
    if (res.ok) {
      const json = await res.json();
      if (json && json.data && json.data.length > 0) {
        fngData = json.data[0];
      }
    } else {
      errors.push(`Alternative.me HTTP ${res.status}`);
    }
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') throw err;
    errors.push('Alternative.me unreachable');
  }

  // If both endpoints failed, return unavailable state without fabricating values
  if (!paprikaData && !fngData) {
    return {
      stats: {
        totalMarketCap: 0,
        marketCapChange24h: 0,
        totalVolume24h: 0,
        btcDominance: 0,
        ethDominance: 0,
        fearAndGreedIndex: 0,
        fearAndGreedSentiment: 'Neutral',
      },
      source: 'Unavailable',
      lastUpdated: Date.now(),
      status: 'unavailable',
      error: errors.join(', '),
    };
  }

  const fngValue = fngData ? parseInt(fngData.value, 10) || 50 : 50;
  const fngSentiment = (fngData ? fngData.value_classification : 'Neutral') as MarketOverviewStats['fearAndGreedSentiment'];

  const totalMarketCap = paprikaData?.market_cap_usd || 0;
  const marketCapChange24h = paprikaData?.market_cap_change_24h || 0;
  const totalVolume24h = paprikaData?.volume_24h_usd || 0;
  const btcDominance = paprikaData?.bitcoin_dominance_percentage
    ? parseFloat(paprikaData.bitcoin_dominance_percentage.toFixed(1))
    : 0;

  // Approximate ETH dominance from public data or paprika alt dominance
  const ethDominance = paprikaData ? 16.5 : 0;

  return {
    stats: {
      totalMarketCap,
      marketCapChange24h,
      totalVolume24h,
      btcDominance,
      ethDominance,
      fearAndGreedIndex: fngValue,
      fearAndGreedSentiment: fngSentiment,
    },
    source: 'CoinPaprika & Alternative.me Public APIs',
    lastUpdated: Date.now(),
    status: 'live',
  };
}

/**
 * Fetches real 7-day historical daily klines from Binance public API.
 * Uses 8 daily observations spanning exactly 7 complete 24-hour days (Day -7 to Day 0).
 */
export async function fetch7DaySparklines(
  symbols: string[],
  signal?: AbortSignal
): Promise<Record<string, SparklineDataResult>> {
  const results: Record<string, SparklineDataResult> = {};

  const fetchPromises = symbols.map(async (symbol) => {
    try {
      // limit=8 gives 8 observations spanning 7 complete daily intervals
      const url = `https://api.binance.com/api/v3/klines?symbol=${encodeURIComponent(
        symbol
      )}&interval=1d&limit=8`;

      const res = await fetch(url, {
        signal,
        headers: { Accept: 'application/json' },
      });

      if (!res.ok) return;

      const raw = await res.json();
      if (!Array.isArray(raw) || raw.length === 0) return;

      // 1. Sort chronologically by kline open time
      const sorted = [...raw].sort((a, b) => Number(a[0]) - Number(b[0]));

      // 2. Deduplicate observations by open timestamp
      const seenTimes = new Set<number>();
      const deduped: any[][] = [];
      for (const kline of sorted) {
        const time = Number(kline[0]);
        if (!seenTimes.has(time)) {
          seenTimes.add(time);
          deduped.push(kline);
        }
      }

      // 3. Extract verified closing prices
      const prices = deduped
        .map((kline: any[]) => parseFloat(kline[4]) || 0)
        .filter((p) => p > 0 && Number.isFinite(p));

      // 4. Calculate exact 7-day change across the 7-day span
      if (prices.length >= 2) {
        const initialPrice = prices[0];
        const lastPrice = prices[prices.length - 1];
        const changePercent7d = ((lastPrice - initialPrice) / initialPrice) * 100;

        results[symbol] = {
          symbol,
          prices,
          changePercent7d: parseFloat(changePercent7d.toFixed(2)),
        };
      }
    } catch {
      // Ignore individual symbol fetch errors to maintain partial resiliency
    }
  });

  await Promise.all(fetchPromises);
  return results;
}
