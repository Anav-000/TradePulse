import { CandleStick, TimeFrame } from '@/types/market';

/**
 * Maps application timeframe tokens to Binance API interval strings.
 */
export function timeframeToBinanceInterval(tf: TimeFrame): string {
  switch (tf) {
    case '1m':
      return '1m';
    case '5m':
      return '5m';
    case '15m':
      return '15m';
    case '1h':
      return '1h';
    case '4h':
      return '4h';
    case '1D':
      return '1d';
    case '1W':
      return '1w';
    default:
      return '1h';
  }
}

/**
 * Validates whether an OHLCV candle has sound financial geometry.
 */
export function isValidCandle(candle: Partial<CandleStick>): candle is CandleStick {
  if (
    typeof candle.time !== 'number' ||
    !Number.isFinite(candle.time) ||
    candle.time <= 0 ||
    typeof candle.open !== 'number' ||
    !Number.isFinite(candle.open) ||
    candle.open <= 0 ||
    typeof candle.high !== 'number' ||
    !Number.isFinite(candle.high) ||
    candle.high <= 0 ||
    typeof candle.low !== 'number' ||
    !Number.isFinite(candle.low) ||
    candle.low <= 0 ||
    typeof candle.close !== 'number' ||
    !Number.isFinite(candle.close) ||
    candle.close <= 0 ||
    typeof candle.volume !== 'number' ||
    !Number.isFinite(candle.volume) ||
    candle.volume < 0
  ) {
    return false;
  }

  // Float precision tolerance
  const epsilon = 1e-8;

  // High must be >= Low
  if (candle.high < candle.low - epsilon) {
    return false;
  }

  // High must be >= Open and Close
  const maxBody = Math.max(candle.open, candle.close);
  if (candle.high < maxBody - epsilon) {
    return false;
  }

  // Low must be <= Open and Close
  const minBody = Math.min(candle.open, candle.close);
  if (candle.low > minBody + epsilon) {
    return false;
  }

  return true;
}

/**
 * Normalizes raw kline arrays (from Binance REST API) into typed, validated,
 * deduplicated, and strictly ascending chronological CandleStick arrays.
 *
 * Raw Binance format:
 * [
 *   0: Open time (ms)
 *   1: Open (string)
 *   2: High (string)
 *   3: Low (string)
 *   4: Close (string)
 *   5: Volume (string)
 *   6: Close time (ms)
 *   ...
 * ]
 */
export function normalizeBinanceKlines(rawRows: unknown[]): CandleStick[] {
  if (!Array.isArray(rawRows) || rawRows.length === 0) {
    return [];
  }

  const validCandles: CandleStick[] = [];

  for (const row of rawRows) {
    if (!Array.isArray(row) || row.length < 6) {
      continue;
    }

    const rawOpenTime = Number(row[0]);
    const rawOpen = parseFloat(String(row[1]));
    const rawHigh = parseFloat(String(row[2]));
    const rawLow = parseFloat(String(row[3]));
    const rawClose = parseFloat(String(row[4]));
    const rawVolume = parseFloat(String(row[5]));

    // TradingView Lightweight Charts requires time in SECONDS
    const timeInSeconds = Math.floor(rawOpenTime / 1000);

    const candleCandidate: CandleStick = {
      time: timeInSeconds,
      open: rawOpen,
      high: rawHigh,
      low: rawLow,
      close: rawClose,
      volume: rawVolume,
    };

    if (isValidCandle(candleCandidate)) {
      validCandles.push(candleCandidate);
    }
  }

  // Sort chronologically ascending
  validCandles.sort((a, b) => a.time - b.time);

  // Deduplicate and ensure strictly increasing timestamps (required by Lightweight Charts)
  const strictlyAscendingCandles: CandleStick[] = [];
  const seenTimes = new Map<number, CandleStick>();

  for (const candle of validCandles) {
    seenTimes.set(candle.time, candle); // overwrite with latest candle if duplicate
  }

  const sortedUniqueTimes = Array.from(seenTimes.keys()).sort((a, b) => a - b);
  for (const time of sortedUniqueTimes) {
    const candle = seenTimes.get(time);
    if (candle) {
      strictlyAscendingCandles.push(candle);
    }
  }

  return strictlyAscendingCandles;
}
