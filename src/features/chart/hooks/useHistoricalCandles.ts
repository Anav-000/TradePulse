import { useQuery } from '@tanstack/react-query';
import { TimeFrame } from '@/types/market';
import { fetchHistoricalCandles, HistoricalCandlesResult } from '@/services/api/marketApi';

/**
 * Custom query hook for fetching and caching real historical candlestick data.
 * TanStack Query handles request cancellation, caching, and background refetching.
 */
export function useHistoricalCandles(symbol: string, timeFrame: TimeFrame) {
  return useQuery<HistoricalCandlesResult, Error>({
    queryKey: ['historicalCandles', symbol, timeFrame],
    queryFn: ({ signal }) => fetchHistoricalCandles(symbol, timeFrame, signal),
    staleTime: 1000 * 30, // 30 seconds
    gcTime: 1000 * 60 * 5, // 5 minutes cache retention
    retry: 2,
    refetchOnWindowFocus: false,
  });
}
