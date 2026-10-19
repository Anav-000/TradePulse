import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { PortfolioView } from './PortfolioView';
import { useTradingStore } from '@/features/trading/stores/useTradingStore';

describe('PortfolioView Component', () => {
  beforeEach(() => {
    useTradingStore.getState().resetAccount();
    localStorage.clear();
  });

  it('renders initial $50,000 equity metrics and 100% USDT cash allocation', () => {
    render(<PortfolioView />);

    expect(screen.getByText('Virtual Portfolio & P&L')).toBeInTheDocument();
    expect(screen.getAllByText('$50,000.00').length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText(/USDT \(Cash\)/i)).toBeInTheDocument();
  });

  it('renders active holdings and quick trade action button', () => {
    useTradingStore.setState({
      positions: {
        SOLUSDT: {
          symbol: 'SOLUSDT',
          baseAsset: 'SOL',
          quoteAsset: 'USDT',
          quantity: 20,
          reservedQuantity: 0,
          availableQuantity: 20,
          averageEntryPrice: 150,
          totalCostBasis: 3000,
          realizedPnl: 0,
          openedAt: Date.now(),
          updatedAt: Date.now(),
        },
      },
    });

    render(<PortfolioView />);

    expect(screen.getAllByText('SOL').length).toBeGreaterThanOrEqual(1);
    expect(screen.getByRole('button', { name: /trade/i })).toBeInTheDocument();
  });

  it('opens confirmation modal and resets wallet on confirmation', () => {
    // Change balance first
    useTradingStore.setState({ usdtBalance: 42000 });

    render(<PortfolioView />);

    // Click Reset Paper Wallet button
    fireEvent.click(screen.getByRole('button', { name: /reset paper wallet/i }));

    // Confirmation modal appears
    expect(screen.getByText(/reset simulated portfolio\?/i)).toBeInTheDocument();

    // Click Confirm Reset
    fireEvent.click(screen.getByRole('button', { name: /confirm reset/i }));

    // Restores to 50,000 USDT
    expect(useTradingStore.getState().usdtBalance).toBe(50000);
    expect(screen.getByText(/paper wallet reset successfully/i)).toBeInTheDocument();
  });
});
