export type OrderType = 'market' | 'limit' | 'stop_limit';
export type OrderSide = 'buy' | 'sell';
export type OrderStatus = 'open' | 'filled' | 'partially_filled' | 'canceled' | 'rejected';

export interface Order {
  id: string;
  symbol: string;
  side: OrderSide;
  type: OrderType;
  price: number;
  amount: number;
  filledAmount: number;
  status: OrderStatus;
  createdAt: number;
  updatedAt: number;
  fee: number;
}

export interface Position {
  id: string;
  symbol: string;
  side: OrderSide;
  size: number;
  entryPrice: number;
  markPrice: number;
  unrealizedPnl: number;
  unrealizedPnlPercent: number;
  liquidationPrice?: number;
  leverage: number;
  openedAt: number;
}

export interface PortfolioSummary {
  totalEquity: number;
  cashBalance: number;
  allocatedMargin: number;
  unrealizedPnl: number;
  realizedPnlToday: number;
  dailyChangePercent: number;
  currency: string;
}
