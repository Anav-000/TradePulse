import { OrderStatus, ProtectiveOrderStatus } from '../types';

/**
 * TradePulse - Order Lifecycle & Transition Authority
 * 
 * Enforces strict, immutable state transitions for all trade and protective orders.
 * Terminal states (filled, canceled, rejected, executed, failed) are immutable
 * and cannot transition to any other status.
 */

// Terminal order states for standard orders
const TERMINAL_ORDER_STATUSES = new Set<OrderStatus>(['filled', 'canceled', 'rejected']);

// Terminal states for protective orders
const TERMINAL_PROTECTIVE_STATUSES = new Set<ProtectiveOrderStatus>(['executed', 'cancelled', 'failed']);

// Valid state transition map for standard orders
const VALID_ORDER_TRANSITIONS: Record<OrderStatus, ReadonlySet<OrderStatus>> = {
  pending: new Set(['filled', 'canceled', 'rejected']),
  filled: new Set(),
  canceled: new Set(),
  rejected: new Set(),
};

// Valid state transition map for protective orders
const VALID_PROTECTIVE_TRANSITIONS: Record<ProtectiveOrderStatus, ReadonlySet<ProtectiveOrderStatus>> = {
  active: new Set(['triggered', 'executed', 'cancelled', 'failed']),
  triggered: new Set(['executed', 'failed']),
  executed: new Set(),
  cancelled: new Set(),
  failed: new Set(),
};

/**
 * Checks whether a standard order can legally transition from currentStatus to nextStatus.
 */
export function canTransitionOrderStatus(
  currentStatus: OrderStatus,
  nextStatus: OrderStatus
): boolean {
  if (isTerminalOrderStatus(currentStatus)) return false;
  return VALID_ORDER_TRANSITIONS[currentStatus]?.has(nextStatus) ?? false;
}

/**
 * Checks whether a protective order can legally transition from currentStatus to nextStatus.
 */
export function canTransitionProtectiveStatus(
  currentStatus: ProtectiveOrderStatus,
  nextStatus: ProtectiveOrderStatus
): boolean {
  if (isTerminalProtectiveStatus(currentStatus)) return false;
  return VALID_PROTECTIVE_TRANSITIONS[currentStatus]?.has(nextStatus) ?? false;
}

/**
 * Checks if a standard order status is terminal.
 */
export function isTerminalOrderStatus(status: OrderStatus): boolean {
  return TERMINAL_ORDER_STATUSES.has(status);
}

/**
 * Checks if a protective order status is terminal.
 */
export function isTerminalProtectiveStatus(status: ProtectiveOrderStatus): boolean {
  return TERMINAL_PROTECTIVE_STATUSES.has(status);
}
