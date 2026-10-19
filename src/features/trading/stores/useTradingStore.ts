import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import Decimal from 'decimal.js';
import {
  TradeOrder,
  Position,
  OrderSide,
  LiveQuote,
  PortfolioStats,
  EquitySnapshot,
  TradeNotification,
  ProtectiveOrder,
} from '../types';
import {
  TradingAccountState,
  createInitialTradingState,
  executeMarketOrder as runMarketOrder,
  placeLimitOrder as runLimitOrder,
  cancelOrder as runCancelOrder,
  processPendingMatches,
  createProtectiveOrders,
  cancelProtectiveOrder as runCancelProtectiveOrder,
  cancelProtectiveGroup as runCancelProtectiveGroup,
  evaluateProtectiveTriggers,
} from '../engine/orderEngine';
import {
  calculatePortfolioStats,
  INITIAL_CAPITAL,
} from '../engine/portfolioAccounting';
import { DEFAULT_FEE_RATE } from '../engine/feeCalculator';
import { useMarketStore } from '@/stores/useMarketStore';
import { wsManager } from '@/services/websocket/BinanceWebSocketManager';

interface TradingStoreState extends TradingAccountState {
  equitySnapshots: EquitySnapshot[];
  notifications: TradeNotification[];
  isSubmitting: boolean;

  // Actions
  executeMarketOrder: (params: {
    symbol: string;
    baseAsset: string;
    quoteAsset: string;
    side: OrderSide;
    quantity: number;
    quote?: LiveQuote;
  }) => Promise<{ success: boolean; error?: string }>;

  placeLimitOrder: (params: {
    symbol: string;
    baseAsset: string;
    quoteAsset: string;
    side: OrderSide;
    quantity: number;
    limitPrice: number;
  }) => Promise<{ success: boolean; error?: string }>;

  cancelOrder: (orderId: string) => { success: boolean; error?: string };
  closePosition: (symbol: string) => Promise<{ success: boolean; error?: string }>;
  setProtectiveOrder: (params: {
    symbol: string;
    baseAsset: string;
    quoteAsset: string;
    quantity: number;
    stopLossPrice?: number;
    takeProfitPrice?: number;
    quote?: LiveQuote;
  }) => Promise<{
    success: boolean;
    error?: string;
    createdOrders?: ProtectiveOrder[];
    groupId?: string;
  }>;
  cancelProtectiveOrder: (orderId: string, options?: { cancelSibling?: boolean }) => { success: boolean; error?: string };
  cancelProtectiveLeg: (orderId: string) => { success: boolean; error?: string };
  cancelProtectiveGroup: (groupId: string) => { success: boolean; error?: string };
  matchPendingOrders: (quotes: Record<string, LiveQuote>) => void;
  recordEquitySnapshot: (force?: boolean) => void;
  resetAccount: () => void;
  addNotification: (notification: Omit<TradeNotification, 'id' | 'timestamp'>) => void;
  dismissNotification: (id: string) => void;

  // Selectors
  getAvailableUsdt: () => number;
  getPosition: (symbol: string) => Position | undefined;
  getOpenOrders: () => TradeOrder[];
  getProtectiveOrders: (symbol?: string) => ProtectiveOrder[];
  getActiveProtectiveOrders: (symbol?: string) => ProtectiveOrder[];
  getPortfolioStats: () => PortfolioStats;
}

// Mutex guard to prevent overlapping matching passes on rapid tick bursts
let isMatchingActive = false;

// Authoritative in-flight mutex guard to prevent overlapping/concurrent order submissions across sync and async paths
let isSubmissionActive = false;

export const useTradingStore = create<TradingStoreState>()(
  persist(
    (set, get) => ({
      ...createInitialTradingState(),
      equitySnapshots: [
        {
          id: `snap_${Date.now()}`,
          timestamp: Date.now(),
          totalEquity: INITIAL_CAPITAL,
          availableUsdt: INITIAL_CAPITAL,
          investedValue: 0,
          unrealizedPnl: 0,
          realizedPnl: 0,
        },
      ],
      notifications: [],
      isSubmitting: false,

      getAvailableUsdt: () => {
        const state = get();
        return Math.max(0, state.usdtBalance - state.usdtReserved);
      },

      getPosition: (symbol: string) => {
        return get().positions[symbol];
      },

      getOpenOrders: () => {
        return get().orders.filter((o) => o.status === 'pending');
      },

      getProtectiveOrders: (symbol?: string) => {
        const orders = get().protectiveOrders || [];
        return symbol ? orders.filter((o) => o.symbol === symbol) : orders;
      },

      getActiveProtectiveOrders: (symbol?: string) => {
        const orders = get().protectiveOrders || [];
        return orders.filter((o) => o.status === 'active' && (!symbol || o.symbol === symbol));
      },

      getPortfolioStats: () => {
        const state = get();
        const marketStore = useMarketStore.getState();
        const prices: Record<string, number> = {};
        marketStore.tickers.forEach((t) => {
          prices[t.symbol] = t.lastPrice;
        });

        return calculatePortfolioStats(
          state.usdtBalance,
          state.usdtReserved,
          state.positions,
          prices,
          state.totalFeesPaid,
          state.totalRealizedPnl
        );
      },

      addNotification: (notif) => {
        const newNotif: TradeNotification = {
          ...notif,
          id: `notif_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
          timestamp: Date.now(),
        };
        set((state) => ({
          notifications: [newNotif, ...state.notifications].slice(0, 10),
        }));
      },

      dismissNotification: (id: string) => {
        set((state) => ({
          notifications: state.notifications.filter((n) => n.id !== id),
        }));
      },

      executeMarketOrder: async (params) => {
        if (isSubmissionActive || get().isSubmitting) {
          return { success: false, error: 'Order submission in progress. Please wait.' };
        }
        isSubmissionActive = true;
        set({ isSubmitting: true });

        try {
          // Retrieve current quote if not explicitly supplied
          let quote = params.quote;
          if (!quote) {
            const marketStore = useMarketStore.getState();
            const bookQuote = wsManager.getLatestBookQuote(params.symbol);
            const ticker = marketStore.tickers.find((t) => t.symbol === params.symbol);
            const ob = marketStore.orderBook && marketStore.orderBook.symbol === params.symbol
              ? marketStore.orderBook
              : null;

            const lastPrice = bookQuote ? bookQuote.lastPrice : ticker ? ticker.lastPrice : 0;
            const bestBid = bookQuote
              ? bookQuote.bidPrice
              : ob && ob.bids.length > 0
              ? ob.bids[0].price
              : lastPrice * 0.9995;
            const bestAsk = bookQuote
              ? bookQuote.askPrice
              : ob && ob.asks.length > 0
              ? ob.asks[0].price
              : lastPrice * 1.0005;

            const isDisconnected = marketStore.connectionStatus === 'disconnected';
            const quoteTimestamp = isDisconnected
              ? 0
              : bookQuote
              ? bookQuote.timestamp
              : ob
              ? ob.lastUpdated
              : Date.now();

            quote = {
              symbol: params.symbol,
              bidPrice: bestBid,
              askPrice: bestAsk,
              lastPrice,
              timestamp: quoteTimestamp,
            };
          }

          const currentState = get();
          const result = runMarketOrder(
            currentState,
            {
              ...params,
              quote,
            },
            DEFAULT_FEE_RATE
          );

          if (!result.success || !result.execution || !result.order) {
            get().addNotification({
              type: 'error',
              title: 'Order Rejected',
              message: result.error || 'Failed to execute market order.',
            });
            return { success: false, error: result.error };
          }

          set(result.newState);

          const sideLabel = params.side === 'buy' ? 'Buy' : 'Sell';
          get().addNotification({
            type: 'success',
            title: `Simulated Market ${sideLabel} Filled`,
            message: `${params.quantity} ${params.baseAsset} @ $${result.execution.price.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} (Fee: $${result.execution.fee.toFixed(2)})`,
          });

          get().recordEquitySnapshot(true);

          // Hold lock across synchronous and microtask turns to block concurrent/overlapping calls
          await Promise.resolve();
          return { success: true };
        } finally {
          isSubmissionActive = false;
          set({ isSubmitting: false });
        }
      },

      placeLimitOrder: async (params) => {
        if (isSubmissionActive || get().isSubmitting) {
          return { success: false, error: 'Order submission in progress. Please wait.' };
        }
        isSubmissionActive = true;
        set({ isSubmitting: true });

        try {
          const currentState = get();
          const result = runLimitOrder(currentState, params, DEFAULT_FEE_RATE);

          if (!result.success || !result.order) {
            get().addNotification({
              type: 'error',
              title: 'Limit Order Rejected',
              message: result.error || 'Failed to place limit order.',
            });
            return { success: false, error: result.error };
          }

          set(result.newState);

          const sideLabel = params.side === 'buy' ? 'Buy' : 'Sell';
          get().addNotification({
            type: 'info',
            title: `Limit ${sideLabel} Order Placed`,
            message: `${params.quantity} ${params.baseAsset} @ $${params.limitPrice.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} (Funds Reserved)`,
          });

          await Promise.resolve();
          return { success: true };
        } finally {
          isSubmissionActive = false;
          set({ isSubmitting: false });
        }
      },

      cancelOrder: (orderId: string) => {
        const currentState = get();
        const result = runCancelOrder(currentState, orderId);

        if (!result.success || !result.canceledOrder) {
          get().addNotification({
            type: 'error',
            title: 'Cancellation Failed',
            message: result.error || 'Unable to cancel order.',
          });
          return { success: false, error: result.error };
        }

        set(result.newState);

        const order = result.canceledOrder;
        get().addNotification({
          type: 'warning',
          title: 'Order Canceled',
          message: `${order.side.toUpperCase()} ${order.quantity} ${order.baseAsset} canceled. Reserved funds released.`,
        });

        return { success: true };
      },

      closePosition: async (symbol: string) => {
        const pos = get().positions[symbol];
        if (!pos || pos.availableQuantity <= 0) {
          return { success: false, error: 'No available position to close.' };
        }

        return get().executeMarketOrder({
          symbol: pos.symbol,
          baseAsset: pos.baseAsset,
          quoteAsset: pos.quoteAsset,
          side: 'sell',
          quantity: pos.availableQuantity,
        });
      },

      setProtectiveOrder: async (params) => {
        if (isSubmissionActive || get().isSubmitting) {
          return { success: false, error: 'Order submission in progress. Please wait.' };
        }
        isSubmissionActive = true;
        set({ isSubmitting: true });

        try {
          // Retrieve current quote if not explicitly supplied
          let quote = params.quote;
          if (!quote) {
            const marketStore = useMarketStore.getState();
            const bookQuote = wsManager.getLatestBookQuote(params.symbol);
            const ticker = marketStore.tickers.find((t) => t.symbol === params.symbol);
            const ob =
              marketStore.orderBook && marketStore.orderBook.symbol === params.symbol
                ? marketStore.orderBook
                : null;

            const lastPrice = bookQuote ? bookQuote.lastPrice : ticker ? ticker.lastPrice : 0;
            const bestBid = bookQuote
              ? bookQuote.bidPrice
              : ob && ob.bids.length > 0
              ? ob.bids[0].price
              : lastPrice;
            const bestAsk = bookQuote
              ? bookQuote.askPrice
              : ob && ob.asks.length > 0
              ? ob.asks[0].price
              : lastPrice;

            quote = {
              symbol: params.symbol,
              bidPrice: bestBid,
              askPrice: bestAsk,
              lastPrice,
              timestamp: Date.now(),
            };
          }

          const currentState = get();
          const result = createProtectiveOrders(currentState, {
            ...params,
            quote,
          });

          if (!result.success || !result.createdOrders) {
            get().addNotification({
              type: 'error',
              title: 'Protection Rejected',
              message: result.error || 'Failed to activate Stop-Loss / Take-Profit protection.',
            });
            return { success: false, error: result.error };
          }

          set(result.newState);

          const createdDescriptions = result.createdOrders.map((o) =>
            o.triggerType === 'stop-loss'
              ? `SL: $${o.triggerPrice.toLocaleString(undefined, { minimumFractionDigits: 2 })}`
              : `TP: $${o.triggerPrice.toLocaleString(undefined, { minimumFractionDigits: 2 })}`
          ).join(' | ');

          get().addNotification({
            type: 'info',
            title: result.createdOrders.length > 1 ? 'OCO Protection Activated' : 'Protection Activated',
            message: `${params.quantity} ${params.baseAsset} protected with ${createdDescriptions}`,
          });

          await Promise.resolve();
          return {
            success: true,
            createdOrders: result.createdOrders,
            groupId: result.groupId,
          };
        } finally {
          isSubmissionActive = false;
          set({ isSubmitting: false });
        }
      },

      cancelProtectiveOrder: (orderId: string, options?: { cancelSibling?: boolean }) => {
        const currentState = get();
        const result = runCancelProtectiveOrder(currentState, orderId, Date.now(), options);

        if (!result.success || !result.canceledOrder) {
          return { success: false, error: result.error };
        }

        set(result.newState);

        const order = result.canceledOrder;
        if (result.isLinkedOco && result.canceledOrders.length > 1) {
          get().addNotification({
            type: 'warning',
            title: 'Linked OCO Protection Cancelled',
            message: `Both Stop-Loss and Take-Profit orders cancelled. Reserved ${order.baseAsset} released.`,
          });
        } else {
          const typeLabel = order.triggerType === 'stop-loss' ? 'Stop-Loss' : 'Take-Profit';
          const releaseText = result.releasedQuantity > 0 ? ` Reserved ${order.baseAsset} released.` : '';
          get().addNotification({
            type: 'warning',
            title: 'Protection Cancelled',
            message: `${typeLabel} for ${order.quantity} ${order.baseAsset} cancelled.${releaseText}`,
          });
        }

        return { success: true };
      },

      cancelProtectiveLeg: (orderId: string) => {
        return get().cancelProtectiveOrder(orderId, { cancelSibling: false });
      },

      cancelProtectiveGroup: (groupId: string) => {
        const currentState = get();
        const result = runCancelProtectiveGroup(currentState, groupId);

        if (!result.success || result.canceledOrders.length === 0) {
          return { success: false, error: result.error };
        }

        set(result.newState);

        const baseAsset = result.canceledOrders[0]?.baseAsset || 'BTC';
        get().addNotification({
          type: 'warning',
          title: 'Linked OCO Protection Cancelled',
          message: `Both Stop-Loss and Take-Profit orders cancelled. Reserved ${baseAsset} released.`,
        });

        return { success: true };
      },

      matchPendingOrders: (quotes: Record<string, LiveQuote>) => {
        if (isMatchingActive) return;
        isMatchingActive = true;

        try {
          let currentState = get();
          let stateChanged = false;

          // 1. Process pending limit orders
          const {
            newState: stateAfterMatches,
            filledOrders,
            executions,
          } = processPendingMatches(currentState, quotes, DEFAULT_FEE_RATE);

          if (filledOrders.length > 0) {
            currentState = { ...currentState, ...stateAfterMatches };
            stateChanged = true;

            filledOrders.forEach((order, idx) => {
              const exec = executions[idx];
              get().addNotification({
                type: 'success',
                title: `Limit ${order.side.toUpperCase()} Filled!`,
                message: `${order.quantity} ${order.baseAsset} filled @ $${order.filledPrice?.toFixed(2)} (Fee: $${exec.fee.toFixed(2)})`,
              });
            });
          }

          // 2. Process active protective triggers (Stop-Loss and Take-Profit)
          const {
            newState: stateAfterProtective,
            triggeredOrders,
            canceledOrders: _canceledOrders,
            executions: protExecutions,
          } = evaluateProtectiveTriggers(currentState, quotes, DEFAULT_FEE_RATE);

          if (triggeredOrders.length > 0) {
            currentState = { ...currentState, ...stateAfterProtective };
            stateChanged = true;

            triggeredOrders.forEach((protOrder, idx) => {
              const exec = protExecutions[idx];
              const isStopLoss = protOrder.triggerType === 'stop-loss';
              const label = isStopLoss ? 'Stop-Loss' : 'Take-Profit';
              const pnlStr =
                protOrder.realizedPnl !== undefined
                  ? ` | Realized P&L: ${protOrder.realizedPnl >= 0 ? '+' : ''}$${protOrder.realizedPnl.toFixed(2)}`
                  : '';

              get().addNotification({
                type: isStopLoss ? 'warning' : 'success',
                title: `${label} Triggered & Executed!`,
                message: `${protOrder.quantity} ${protOrder.baseAsset} sold @ $${protOrder.executionPrice?.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}${pnlStr} (Fee: $${exec?.fee.toFixed(2)})`,
              });
            });
          }

          if (stateChanged) {
            set(currentState);
            get().recordEquitySnapshot(true);
          }
        } finally {
          isMatchingActive = false;
        }
      },

      recordEquitySnapshot: (force: boolean = false) => {
        const state = get();
        const now = Date.now();
        const lastSnap = state.equitySnapshots[state.equitySnapshots.length - 1];

        // Throttle snapshots: at least 15 seconds unless forced by a trade
        if (!force && lastSnap && now - lastSnap.timestamp < 15_000) {
          return;
        }

        const stats = get().getPortfolioStats();
        const newSnapshot: EquitySnapshot = {
          id: `snap_${now}_${Math.random().toString(36).substring(2, 6)}`,
          timestamp: now,
          totalEquity: stats.totalEquity,
          availableUsdt: stats.availableUsdt,
          investedValue: stats.investedValue,
          unrealizedPnl: stats.unrealizedPnl,
          realizedPnl: stats.realizedPnl,
        };

        set((s) => ({
          equitySnapshots: [...s.equitySnapshots.slice(-100), newSnapshot],
        }));
      },

      resetAccount: () => {
        isSubmissionActive = false;
        isMatchingActive = false;
        const initial = createInitialTradingState();
        set({
          ...initial,
          isSubmitting: false,
          protectiveOrders: [],
          equitySnapshots: [
            {
              id: `snap_${Date.now()}`,
              timestamp: Date.now(),
              totalEquity: INITIAL_CAPITAL,
              availableUsdt: INITIAL_CAPITAL,
              investedValue: 0,
              unrealizedPnl: 0,
              realizedPnl: 0,
            },
          ],
        });

        get().addNotification({
          type: 'info',
          title: 'Account Reset',
          message: 'Virtual wallet reset to $50,000.00 USDT. Positions, orders, and protective triggers cleared.',
        });
      },
    }),
    {
      name: 'tradepulse_trading_state_v1',
      storage: createJSONStorage(() => localStorage),
      version: 2,
      partialize: (state) => ({
        usdtBalance: state.usdtBalance,
        usdtReserved: state.usdtReserved,
        positions: state.positions,
        orders: state.orders,
        executions: state.executions,
        protectiveOrders: state.protectiveOrders,
        equitySnapshots: state.equitySnapshots,
        totalRealizedPnl: state.totalRealizedPnl,
        totalFeesPaid: state.totalFeesPaid,
      }),
      // Non-destructive rehydration validation & migration
      migrate: (persistedState: any) => {
        return reconcileTradingState(persistedState);
      },
      onRehydrateStorage: () => (state) => {
        if (state) {
          const reconciled = reconcileTradingState(state);
          useTradingStore.setState(reconciled);
        }
      },
    }
  )
);

/**
 * Safely reconciles persisted trading account state non-destructively:
 * - Preserves all trade history, orders, executions, and equity snapshots.
 * - Validates numeric finiteness of balances.
 * - Reconciles usdtReserved against open buy orders.
 * - Reconciles position reservedQuantity against open sell limit orders and active protective orders.
 * - Reconciles availableQuantity = max(0, quantity - reservedQuantity).
 * - Never silently deletes positions or balances.
 */
export function reconcileTradingState(state: any): any {
  if (!state || typeof state !== 'object') {
    return {
      ...createInitialTradingState(),
      equitySnapshots: [],
    };
  }

  // 1. Ensure arrays exist and are preserved
  const orders = Array.isArray(state.orders) ? state.orders : [];
  const executions = Array.isArray(state.executions) ? state.executions : [];
  const protectiveOrders = Array.isArray(state.protectiveOrders) ? state.protectiveOrders : [];
  const equitySnapshots = Array.isArray(state.equitySnapshots) ? state.equitySnapshots : [];

  // 2. Validate USDT Balance non-destructively
  let usdtBalance = Number.isFinite(state.usdtBalance) ? state.usdtBalance : INITIAL_CAPITAL;
  if (usdtBalance < 0) {
    console.warn('[TradePulse Recovery] Negative USDT balance detected in persisted storage; clamped to 0.');
    usdtBalance = 0;
  }

  // 3. Reconcile usdtReserved from pending BUY limit orders
  let activeBuyReservations = new Decimal(0);
  for (const o of orders) {
    if (o && o.status === 'pending' && o.side === 'buy' && Number.isFinite(o.reservedAmount) && o.reservedAmount > 0) {
      activeBuyReservations = activeBuyReservations.add(o.reservedAmount);
    }
  }
  const reconciledUsdtReserved = activeBuyReservations.toDecimalPlaces(4, Decimal.ROUND_HALF_UP).toNumber();

  // 4. Reconcile Positions
  const positions: Record<string, Position> = {};
  const rawPositions = state.positions && typeof state.positions === 'object' ? state.positions : {};

  for (const [symbol, rawPos] of Object.entries(rawPositions)) {
    const pos = rawPos as Position;
    if (!pos || !Number.isFinite(pos.quantity) || pos.quantity <= 0) {
      continue;
    }

    // Tally active sell limit reservations for this symbol
    let activeSellLimitRes = new Decimal(0);
    for (const o of orders) {
      if (o && o.status === 'pending' && o.side === 'sell' && o.symbol === symbol && Number.isFinite(o.reservedAmount) && o.reservedAmount > 0) {
        activeSellLimitRes = activeSellLimitRes.add(o.reservedAmount);
      }
    }

    // Tally active protective orders for this symbol (one reservation per groupId)
    const activeProtective = protectiveOrders.filter((p: ProtectiveOrder) => p && p.symbol === symbol && p.status === 'active');
    const groupReservedMap = new Map<string, number>();
    for (const p of activeProtective) {
      if (!groupReservedMap.has(p.groupId) && Number.isFinite(p.quantity) && p.quantity > 0) {
        groupReservedMap.set(p.groupId, p.quantity);
      }
    }
    let activeProtRes = new Decimal(0);
    for (const qty of groupReservedMap.values()) {
      activeProtRes = activeProtRes.add(qty);
    }

    const totalCalculatedReserved = activeSellLimitRes.add(activeProtRes).toDecimalPlaces(8, Decimal.ROUND_HALF_UP);
    const posQty = new Decimal(pos.quantity);

    // Reserved cannot exceed total held
    const finalReserved = Decimal.min(posQty, totalCalculatedReserved).toNumber();
    const finalAvailable = Decimal.max(0, posQty.sub(finalReserved)).toDecimalPlaces(8, Decimal.ROUND_HALF_UP).toNumber();

    positions[symbol] = {
      ...pos,
      reservedQuantity: finalReserved,
      availableQuantity: finalAvailable,
    };
  }

  return {
    ...state,
    usdtBalance,
    usdtReserved: reconciledUsdtReserved,
    positions,
    orders,
    executions,
    protectiveOrders,
    equitySnapshots,
    totalRealizedPnl: Number.isFinite(state.totalRealizedPnl) ? state.totalRealizedPnl : 0,
    totalFeesPaid: Number.isFinite(state.totalFeesPaid) ? state.totalFeesPaid : 0,
  };
}

// Multi-Tab Synchronization & Eventual Consistency:
// When another browser tab mutates simulated account state in localStorage,
// propagate the update to this tab's in-memory store non-destructively.
if (typeof window !== 'undefined') {
  window.addEventListener('storage', (event) => {
    if (event.key === 'tradepulse_trading_state_v1' && event.newValue) {
      try {
        const parsed = JSON.parse(event.newValue);
        if (parsed && parsed.state) {
          const reconciled = reconcileTradingState(parsed.state);
          useTradingStore.setState((s) => ({
            ...s,
            ...reconciled,
          }));
        }
      } catch (err) {
        console.warn('[TradePulse Multi-Tab Sync] Could not parse cross-tab storage event update:', err);
      }
    }
  });
}
