import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { BottomDock } from './BottomDock';
import { useTradingStore } from '@/features/trading/stores/useTradingStore';

describe('BottomDock Component', () => {
  beforeEach(() => {
    useTradingStore.getState().resetAccount();
    localStorage.clear();
  });

  it('renders empty positions state by default', () => {
    render(<BottomDock />);
    expect(screen.getByText(/no active positions yet/i)).toBeInTheDocument();
  });

  it('renders active positions with mark price and quick close button', () => {
    // Inject a position into the store
    useTradingStore.setState({
      positions: {
        BTCUSDT: {
          symbol: 'BTCUSDT',
          baseAsset: 'BTC',
          quoteAsset: 'USDT',
          quantity: 0.5,
          reservedQuantity: 0,
          availableQuantity: 0.5,
          averageEntryPrice: 80000,
          totalCostBasis: 40000,
          realizedPnl: 0,
          openedAt: Date.now(),
          updatedAt: Date.now(),
        },
      },
    });

    render(<BottomDock />);

    // Shows BTC/USDT position
    expect(screen.getByText('BTC')).toBeInTheDocument();
    expect(screen.getByText(/0.5000 BTC/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /quick close/i })).toBeInTheDocument();
  });

  it('switches to Open Orders tab and allows canceling pending orders', () => {
    // Inject a pending order
    useTradingStore.setState({
      orders: [
        {
          id: 'ord_test_123',
          symbol: 'BTCUSDT',
          baseAsset: 'BTC',
          quoteAsset: 'USDT',
          side: 'buy',
          type: 'limit',
          price: 78000,
          quantity: 0.1,
          fee: 3.9,
          status: 'pending',
          reservedAmount: 7803.9,
          createdAt: Date.now(),
        },
      ],
      usdtReserved: 7803.9,
    });

    render(<BottomDock />);

    // Switch to Open Orders tab
    fireEvent.click(screen.getByRole('button', { name: /open orders/i }));

    expect(screen.getByText(/st_123/i)).toBeInTheDocument();
    expect(screen.getByText('$78,000.00')).toBeInTheDocument();
    expect(screen.getByText(/pending/i)).toBeInTheDocument();

    // Click Cancel
    fireEvent.click(screen.getByRole('button', { name: /cancel/i }));

    // Order is canceled, list shows empty
    expect(screen.getByText(/no open limit orders/i)).toBeInTheDocument();
    expect(useTradingStore.getState().usdtReserved).toBe(0);
  });

  it('switches to Trade History tab and displays executions', () => {
    useTradingStore.setState({
      executions: [
        {
          id: 'exec_abc_999',
          orderId: 'ord_1',
          symbol: 'ETHUSDT',
          baseAsset: 'ETH',
          quoteAsset: 'USDT',
          side: 'buy',
          type: 'market',
          price: 2400,
          quantity: 2.0,
          grossValue: 4800,
          fee: 2.4,
          netValue: 4802.4,
          timestamp: Date.now(),
        },
      ],
    });

    render(<BottomDock />);

    // Switch to Trade History tab
    fireEvent.click(screen.getByRole('button', { name: /trade history/i }));

    expect(screen.getByText(/#bc_999/i)).toBeInTheDocument();
    expect(screen.getByText('ETHUSDT')).toBeInTheDocument();
    expect(screen.getByText('$4,800.00')).toBeInTheDocument();
  });

  it('switches to Protection tab and renders active protective orders with cancel action', () => {
    useTradingStore.setState({
      protectiveOrders: [
        {
          id: 'prot_sl_101',
          symbol: 'BTCUSDT',
          baseAsset: 'BTC',
          quoteAsset: 'USDT',
          side: 'sell',
          triggerType: 'stop-loss',
          triggerPrice: 78000,
          quantity: 0.05,
          status: 'active',
          groupId: 'grp_1',
          createdAt: Date.now(),
        },
      ],
    });

    render(<BottomDock />);

    // Click Protection tab
    fireEvent.click(screen.getByRole('button', { name: /protection/i }));

    expect(screen.getByText(/stop-loss/i)).toBeInTheDocument();
    expect(screen.getByText('$78,000.00')).toBeInTheDocument();
    expect(screen.getByText('0.05 BTC')).toBeInTheDocument();

    // Cancel order
    fireEvent.click(screen.getByRole('button', { name: /cancel/i }));

    expect(useTradingStore.getState().protectiveOrders[0].status).toBe('cancelled');
  });
});
