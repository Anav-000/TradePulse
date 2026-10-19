import { useEffect, useState } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useUIStore } from '@/stores/useUIStore';
import { useMarketStore } from '@/stores/useMarketStore';
import { Header } from '@/components/layout/Header';
import { Sidebar } from '@/components/layout/Sidebar';
import { TickerTape } from '@/components/layout/TickerTape';
import { SimulationBanner } from '@/components/feedback/SimulationBanner';
import { TradingToaster } from '@/components/feedback/TradingToaster';
import { TerminalDashboard } from '@/features/terminal/TerminalDashboard';
import { MarketOverview } from '@/features/market/MarketOverview';
import { WatchlistView } from '@/features/watchlist/WatchlistView';
import { PortfolioView } from '@/features/portfolio/PortfolioView';
import { formatTerminalTime } from '@/lib/formatters';
import { Shield, Cpu, Clock } from 'lucide-react';

import { useWebSocketStream } from '@/services/websocket/useWebSocketStream';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchOnWindowFocus: false,
      staleTime: 1000 * 30, // 30 seconds
    },
  },
});

export function AppContent() {
  useWebSocketStream();
  const { activeView } = useUIStore();
  const { selectedSymbol } = useMarketStore();
  const [currentTime, setCurrentTime] = useState<Date>(new Date());

  useEffect(() => {
    const timer = setInterval(() => setCurrentTime(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  return (
    <div className="flex h-screen flex-col bg-[#080a10] text-[#94a3b8] overflow-hidden antialiased select-none">
      {/* Simulation Banner & Trading Toaster */}
      <SimulationBanner />
      <TradingToaster />

      {/* Primary Navigation Header */}
      <Header />

      {/* Top Scrolling / Clickable Ticker Tape */}
      <TickerTape />

      {/* Main Body with Sidebar + Dynamic View */}
      <div className="flex flex-1 overflow-hidden">
        {/* Responsive Collapsible Sidebar */}
        <Sidebar />

        {/* Scrollable View Area */}
        <main className="flex-1 overflow-y-auto bg-[#080a10]">
          {activeView === 'terminal' && <TerminalDashboard />}
          {activeView === 'overview' && <MarketOverview />}
          {activeView === 'watchlist' && <WatchlistView />}
          {activeView === 'portfolio' && <PortfolioView />}
        </main>
      </div>

      {/* Terminal Status / Footer Bar */}
      <footer className="flex h-7 items-center justify-between border-t border-[#182030] bg-[#07090f] px-3 text-[10px] text-slate-500 font-mono">
        <div className="flex items-center gap-3">
          <span className="flex items-center gap-1 text-emerald-400 font-semibold">
            <Shield className="h-3 w-3" />
            <span>SANDBOX ENV</span>
          </span>
          <span className="text-slate-600">|</span>
          <span className="flex items-center gap-1 text-slate-400">
            <Cpu className="h-3 w-3 text-cyan-400" />
            <span>Active: {selectedSymbol}</span>
          </span>
          <span className="text-slate-600 hidden sm:inline">|</span>
          <span className="text-slate-400 hidden sm:inline">TradePulse Terminal v0.1.0-alpha</span>
        </div>

        <div className="flex items-center gap-2">
          <Clock className="h-3 w-3 text-slate-500" />
          <span className="text-slate-300 tabular-nums">
            UTC {currentTime.toISOString().slice(11, 19)}
          </span>
          <span className="text-slate-600 hidden md:inline">|</span>
          <span className="text-slate-400 hidden md:inline">
            Local: {formatTerminalTime(currentTime)}
          </span>
        </div>
      </footer>
    </div>
  );
}

export function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <AppContent />
    </QueryClientProvider>
  );
}

export default App;
