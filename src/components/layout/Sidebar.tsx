import { useUIStore, ActiveView } from '@/stores/useUIStore';
import { cn } from '@/lib/utils';
import {
  LayoutGrid,
  LineChart,
  Star,
  Wallet,
  ChevronLeft,
  ChevronRight,
  Shield,
} from 'lucide-react';

interface NavItem {
  id: ActiveView;
  label: string;
  icon: React.ElementType;
  badge?: string;
}

const NAV_ITEMS: NavItem[] = [
  { id: 'terminal', label: 'Trading Terminal', icon: LineChart },
  { id: 'overview', label: 'Market Overview', icon: LayoutGrid },
  { id: 'watchlist', label: 'Watchlist', icon: Star },
  { id: 'portfolio', label: 'Portfolio & P&L', icon: Wallet, badge: '$50k' },
];

export function Sidebar() {
  const {
    activeView,
    setActiveView,
    isSidebarCollapsed,
    toggleSidebar,
    isMobileMenuOpen,
    setMobileMenuOpen,
  } = useUIStore();

  const sidebarContent = (
    <div className="flex h-full flex-col justify-between p-2">
      {/* Top Nav links */}
      <div className="space-y-1">
        <div className="px-3 py-2">
          {!isSidebarCollapsed && (
            <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500">
              Navigation
            </span>
          )}
        </div>

        {NAV_ITEMS.map((item) => {
          const Icon = item.icon;
          const isActive = activeView === item.id;

          return (
            <button
              key={item.id}
              onClick={() => setActiveView(item.id)}
              title={isSidebarCollapsed ? item.label : undefined}
              className={cn(
                'group flex w-full items-center gap-3 rounded-md px-3 py-2 text-xs font-medium transition-all select-none',
                isActive
                  ? 'bg-cyan-950/40 text-cyan-400 border border-cyan-800/40 shadow-sm'
                  : 'text-slate-400 hover:bg-[#151b2a] hover:text-slate-200'
              )}
            >
              <Icon
                className={cn(
                  'h-4 w-4 shrink-0 transition-colors',
                  isActive ? 'text-cyan-400' : 'text-slate-500 group-hover:text-slate-300'
                )}
              />
              {!isSidebarCollapsed && (
                <div className="flex flex-1 items-center justify-between">
                  <span>{item.label}</span>
                  {item.badge && (
                    <span className="rounded bg-[#1e273a] px-1.5 py-0.5 text-[9px] font-mono text-emerald-400">
                      {item.badge}
                    </span>
                  )}
                </div>
              )}
            </button>
          );
        })}
      </div>

      {/* Bottom Section */}
      <div className="space-y-2 border-t border-[#182030] pt-2">
        {/* Paper trading badge */}
        {!isSidebarCollapsed ? (
          <div className="rounded-md border border-indigo-500/20 bg-indigo-950/20 p-2 text-[10px] text-indigo-300">
            <div className="flex items-center gap-1.5 font-semibold">
              <Shield className="h-3.5 w-3.5 text-indigo-400" />
              <span>Simulated Mode</span>
            </div>
            <p className="mt-1 text-slate-400">Zero financial risk environment</p>
          </div>
        ) : (
          <div className="flex justify-center py-1" title="Paper Trading Mode Active">
            <Shield className="h-4 w-4 text-indigo-400" />
          </div>
        )}

        {/* Collapse toggle (Desktop only) */}
        <button
          onClick={toggleSidebar}
          aria-label={isSidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          className="hidden md:flex w-full items-center justify-center rounded-md p-2 text-slate-400 hover:bg-[#151b2a] hover:text-white transition-colors"
        >
          {isSidebarCollapsed ? (
            <ChevronRight className="h-4 w-4" />
          ) : (
            <div className="flex w-full items-center justify-between px-1 text-xs">
              <span className="text-slate-400">Collapse</span>
              <ChevronLeft className="h-4 w-4" />
            </div>
          )}
        </button>
      </div>
    </div>
  );

  return (
    <>
      {/* Desktop Sidebar */}
      <aside
        className={cn(
          'hidden md:block border-r border-[#182030] bg-[#0b0e17] transition-all duration-200 shrink-0 select-none',
          isSidebarCollapsed ? 'w-16' : 'w-56'
        )}
      >
        {sidebarContent}
      </aside>

      {/* Mobile Drawer Backdrop */}
      {isMobileMenuOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/70 backdrop-blur-sm md:hidden"
          onClick={() => setMobileMenuOpen(false)}
        />
      )}

      {/* Mobile Drawer */}
      <div
        className={cn(
          'fixed inset-y-0 left-0 z-50 w-64 border-r border-[#182030] bg-[#0b0e17] transform transition-transform duration-200 ease-in-out md:hidden',
          isMobileMenuOpen ? 'translate-x-0' : '-translate-x-full'
        )}
      >
        <div className="flex h-14 items-center justify-between border-b border-[#182030] px-4">
          <span className="font-bold text-white text-sm">TradePulse Menu</span>
        </div>
        {sidebarContent}
      </div>
    </>
  );
}
