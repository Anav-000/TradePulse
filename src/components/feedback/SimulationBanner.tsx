import { useUIStore } from '@/stores/useUIStore';
import { useMarketStore } from '@/stores/useMarketStore';
import { ShieldAlert, X } from 'lucide-react';

export function SimulationBanner() {
  const { simulationBannerDismissed, dismissSimulationBanner } = useUIStore();
  const connectionStatus = useMarketStore((s) => s.connectionStatus);

  if (simulationBannerDismissed) return null;

  const getMarketDataNotice = () => {
    switch (connectionStatus) {
      case 'connected':
        return 'Market data is sourced from live exchange feeds.';
      case 'connecting':
        return 'Connecting to live exchange feeds...';
      case 'stale':
        return 'Market data feed is temporarily stale (reconnecting...).';
      case 'disconnected':
        return 'Live market data feed is disconnected.';
      case 'simulated':
      default:
        return 'Market data is currently in fallback mode.';
    }
  };

  return (
    <div className="relative flex items-center justify-between border-b border-indigo-900/50 bg-gradient-to-r from-indigo-950/80 via-[#0e1628] to-indigo-950/80 px-4 py-1.5 text-xs text-indigo-200 select-none">
      <div className="flex items-center gap-2 overflow-hidden">
        <ShieldAlert className="h-4 w-4 shrink-0 text-indigo-400" />
        <span className="truncate">
          <strong className="font-semibold text-indigo-300">PAPER TRADING MODE:</strong>{' '}
          {getMarketDataNotice()} Orders, positions, and account balances are simulated. No real funds are used.
        </span>
      </div>
      <button
        onClick={dismissSimulationBanner}
        aria-label="Dismiss disclaimer"
        className="ml-4 rounded p-0.5 text-indigo-400 hover:bg-indigo-900/40 hover:text-indigo-200 transition-colors"
      >
        <X className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}
