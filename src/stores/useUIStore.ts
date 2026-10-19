import { create } from 'zustand';

export type ActiveView = 'terminal' | 'overview' | 'watchlist' | 'portfolio';

interface UIState {
  activeView: ActiveView;
  isSidebarCollapsed: boolean;
  isMobileMenuOpen: boolean;
  isCompactDensity: boolean;
  simulationBannerDismissed: boolean;
  
  // Actions
  setActiveView: (view: ActiveView) => void;
  toggleSidebar: () => void;
  setSidebarCollapsed: (collapsed: boolean) => void;
  setMobileMenuOpen: (open: boolean) => void;
  toggleCompactDensity: () => void;
  dismissSimulationBanner: () => void;
}

export const useUIStore = create<UIState>((set) => ({
  activeView: 'terminal',
  isSidebarCollapsed: false,
  isMobileMenuOpen: false,
  isCompactDensity: false,
  simulationBannerDismissed: false,

  setActiveView: (activeView) => set({ activeView, isMobileMenuOpen: false }),
  toggleSidebar: () => set((state) => ({ isSidebarCollapsed: !state.isSidebarCollapsed })),
  setSidebarCollapsed: (isSidebarCollapsed) => set({ isSidebarCollapsed }),
  setMobileMenuOpen: (isMobileMenuOpen) => set({ isMobileMenuOpen }),
  toggleCompactDensity: () => set((state) => ({ isCompactDensity: !state.isCompactDensity })),
  dismissSimulationBanner: () => set({ simulationBannerDismissed: true }),
}));
