import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { OrderEntryPanel } from './OrderEntryPanel';
import { CryptoTicker, OrderBookData } from '@/types/market';
import { useTradingStore } from './stores/useTradingStore';

const mockBtcTicker: CryptoTicker = {
  symbol: 'BTCUSDT',
  baseAsset: 'BTC',
  quoteAsset: 'USDT',
  name: 'Bitcoin',
  lastPrice: 81500.00,
  previousClosePrice: 81000.00,
  priceChange24h: 500.00,
  priceChangePercent24h: 0.62,
  high24h: 82000.00,
  low24h: 80500.00,
  volume24h: 35000,
  quoteVolume24h: 2850000000,
  sparkline7d: [80000, 81000, 81500],
};

const mockEthTicker: CryptoTicker = {
  symbol: 'ETHUSDT',
  baseAsset: 'ETH',
  quoteAsset: 'USDT',
  name: 'Ethereum',
  lastPrice: 2420.50,
  previousClosePrice: 2400.00,
  priceChange24h: 20.50,
  priceChangePercent24h: 0.85,
  high24h: 2450.00,
  low24h: 2380.00,
  volume24h: 150000,
  quoteVolume24h: 363000000,
  sparkline7d: [2380, 2400, 2420.5],
};

const mockOrderBook: OrderBookData = {
  symbol: 'BTCUSDT',
  bids: [
    { price: 81495.00, amount: 0.5, total: 40747.5, depth: 80 },
    { price: 81490.00, amount: 1.0, total: 81490, depth: 60 },
  ],
  asks: [
    { price: 81505.00, amount: 0.8, total: 65204, depth: 75 },
    { price: 81510.00, amount: 1.2, total: 97812, depth: 55 },
  ],
  spread: 10.00,
  spreadPercentage: 0.012,
  lastUpdateId: 12345,
  lastUpdated: Date.now(),
};

describe('OrderEntryPanel Component', () => {
  beforeEach(() => {
    useTradingStore.getState().resetAccount();
  });

  it('synchronizes limit price with current market price on initial render', () => {
    render(
      <OrderEntryPanel
        selectedTicker={mockBtcTicker}
        orderBook={mockOrderBook}
        connectionStatus="connected"
      />
    );

    const priceInput = screen.getByTestId('order-price-input') as HTMLInputElement;
    expect(priceInput.value).toBe('81500');
  });

  it('updates price when switching to another cryptocurrency', () => {
    const { rerender } = render(
      <OrderEntryPanel
        selectedTicker={mockBtcTicker}
        orderBook={mockOrderBook}
        connectionStatus="connected"
      />
    );

    const priceInput = screen.getByTestId('order-price-input') as HTMLInputElement;
    expect(priceInput.value).toBe('81500');

    // Switch to ETH
    rerender(
      <OrderEntryPanel
        selectedTicker={mockEthTicker}
        orderBook={null}
        connectionStatus="connected"
      />
    );

    expect(priceInput.value).toBe('2420.5');
  });

  it('preserves manually entered limit price when market ticks arrive', () => {
    const { rerender } = render(
      <OrderEntryPanel
        selectedTicker={mockBtcTicker}
        orderBook={mockOrderBook}
        connectionStatus="connected"
      />
    );

    const priceInput = screen.getByTestId('order-price-input') as HTMLInputElement;
    expect(priceInput.value).toBe('81500');

    // User enters a custom limit price
    fireEvent.change(priceInput, { target: { value: '80000' } });
    expect(priceInput.value).toBe('80000');

    // Market tick arrives with new price $81,550
    const updatedBtc = { ...mockBtcTicker, lastPrice: 81550 };
    rerender(
      <OrderEntryPanel
        selectedTicker={updatedBtc}
        orderBook={mockOrderBook}
        connectionStatus="connected"
      />
    );

    // Manual price MUST NOT be overwritten
    expect(priceInput.value).toBe('80000');
  });

  it('switches between Market and Limit modes with correct executable quotes', () => {
    render(
      <OrderEntryPanel
        selectedTicker={mockBtcTicker}
        orderBook={mockOrderBook}
        connectionStatus="connected"
      />
    );

    // In Limit mode initially
    expect(screen.getByTestId('order-price-input')).toBeInTheDocument();

    // Switch to Market mode
    fireEvent.click(screen.getByRole('button', { name: /^market$/i }));

    // Price input is replaced by executable quote reference
    expect(screen.getByText('Market Reference')).toBeInTheDocument();
    // Buy order uses Best Ask ($81,505.00)
    expect(screen.getAllByText('$81,505.00').length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText(/best ask/i)).toBeInTheDocument();

    // Switch to Sell direction
    fireEvent.click(screen.getByRole('button', { name: /^sell btc$/i }));
    // Sell order uses Best Bid ($81,495.00)
    expect(screen.getAllByText('$81,495.00').length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText(/best bid/i)).toBeInTheDocument();
  });

  it('calculates order value and 0.05% estimated fee accurately without NaN', () => {
    render(
      <OrderEntryPanel
        selectedTicker={mockBtcTicker}
        orderBook={mockOrderBook}
        connectionStatus="connected"
      />
    );

    // Quantity default is 0.1, price 81,500
    // Order value = 0.1 * 81,500 = $8,150.00
    expect(screen.getByText('$8,150.00')).toBeInTheDocument();

    // Estimated fee = 8,150 * 0.0005 = $4.08
    expect(screen.getByText('$4.08')).toBeInTheDocument();

    // Total required for buy = 8,150 + 4.08 = $8,154.08
    expect(screen.getByText('$8,154.08')).toBeInTheDocument();
  });

  it('calculates percentage presets based on available USDT paper balance', () => {
    render(
      <OrderEntryPanel
        selectedTicker={mockBtcTicker}
        orderBook={mockOrderBook}
        connectionStatus="connected"
      />
    );

    // Click 50% preset
    // 50% of $50,000 = $25,000 budget
    // targetAmount = 25,000 / (81,500 * 1.0005) ≈ 0.30659 BTC
    fireEvent.click(screen.getByRole('button', { name: '50%' }));

    const amountInput = screen.getByTestId('order-amount-input') as HTMLInputElement;
    expect(parseFloat(amountInput.value)).toBeCloseTo(0.3065, 3);
  });

  it('disables submission when total exceeds paper balance', () => {
    render(
      <OrderEntryPanel
        selectedTicker={mockBtcTicker}
        orderBook={mockOrderBook}
        connectionStatus="connected"
      />
    );

    const amountInput = screen.getByTestId('order-amount-input') as HTMLInputElement;

    // Order 2 BTC ($163,000 > $50,000 balance)
    fireEvent.change(amountInput, { target: { value: '2' } });

    expect(screen.getByText(/exceeds available paper balance/i)).toBeInTheDocument();
    const submitBtn = screen.getByRole('button', { name: /insufficient usdt balance/i });
    expect(submitBtn).toBeDisabled();
  });

  it('disables submission when price or quantity is invalid (zero or negative)', () => {
    render(
      <OrderEntryPanel
        selectedTicker={mockBtcTicker}
        orderBook={mockOrderBook}
        connectionStatus="connected"
      />
    );

    const amountInput = screen.getByTestId('order-amount-input') as HTMLInputElement;

    // Set amount to 0
    fireEvent.change(amountInput, { target: { value: '0' } });

    const submitBtn = screen.getByRole('button', { name: /enter valid quantity/i });
    expect(submitBtn).toBeDisabled();
  });

  it('populates limit price when externalPrice prop is provided (e.g. clicked from order book)', () => {
    const handlePriceHandled = vi.fn();
    const { rerender } = render(
      <OrderEntryPanel
        selectedTicker={mockBtcTicker}
        orderBook={mockOrderBook}
        connectionStatus="connected"
      />
    );

    rerender(
      <OrderEntryPanel
        selectedTicker={mockBtcTicker}
        orderBook={mockOrderBook}
        connectionStatus="connected"
        externalPrice={81492.25}
        onExternalPriceHandled={handlePriceHandled}
      />
    );

    const priceInput = screen.getByTestId('order-price-input') as HTMLInputElement;
    expect(priceInput.value).toBe('81492.25');
    expect(handlePriceHandled).toHaveBeenCalled();
  });

  it('disables submission when market data is unavailable without valid price', () => {
    const zeroTicker = { ...mockBtcTicker, lastPrice: 0 };
    render(
      <OrderEntryPanel
        selectedTicker={zeroTicker}
        orderBook={null}
        connectionStatus="disconnected"
      />
    );

    const submitBtn = screen.getByRole('button', { name: /market data unavailable/i });
    expect(submitBtn).toBeDisabled();
  });

  it('disables market order submission when connection is disconnected or stale', () => {
    const { rerender } = render(
      <OrderEntryPanel
        selectedTicker={mockBtcTicker}
        orderBook={mockOrderBook}
        connectionStatus="disconnected"
      />
    );

    // Switch to Market mode
    fireEvent.click(screen.getByRole('button', { name: /^market$/i }));

    // Must be disabled with clear indication
    const disconnectedBtn = screen.getByRole('button', { name: /exchange disconnected/i });
    expect(disconnectedBtn).toBeDisabled();

    // Rerender with stale status
    rerender(
      <OrderEntryPanel
        selectedTicker={mockBtcTicker}
        orderBook={mockOrderBook}
        connectionStatus="stale"
      />
    );

    const staleBtn = screen.getByRole('button', { name: /market data stale/i });
    expect(staleBtn).toBeDisabled();
  });

  it('resets order quantity to empty string after confirmed successful market execution', async () => {
    render(
      <OrderEntryPanel
        selectedTicker={mockBtcTicker}
        orderBook={mockOrderBook}
        connectionStatus="connected"
      />
    );

    // Switch to Market mode
    fireEvent.click(screen.getByRole('button', { name: /^market$/i }));

    const amountInput = screen.getByTestId('order-amount-input') as HTMLInputElement;
    fireEvent.change(amountInput, { target: { value: '0.05' } });
    expect(amountInput.value).toBe('0.05');

    // Submit market order
    const submitBtn = screen.getByRole('button', { name: /simulate buy btc/i });
    fireEvent.click(submitBtn);

    // After execution, amount input should be reset to empty string
    await waitFor(() => {
      expect(amountInput.value).toBe('');
    });
  });

  it('retains order quantity if market order execution fails', async () => {
    const mockFail = vi.fn().mockResolvedValue({ success: false, error: 'Simulated rejection' });
    useTradingStore.setState({ executeMarketOrder: mockFail });

    render(
      <OrderEntryPanel
        selectedTicker={mockBtcTicker}
        orderBook={mockOrderBook}
        connectionStatus="connected"
      />
    );

    fireEvent.click(screen.getByRole('button', { name: /^market$/i }));
    const amountInput = screen.getByTestId('order-amount-input') as HTMLInputElement;
    fireEvent.change(amountInput, { target: { value: '0.05' } });

    const submitBtn = screen.getByRole('button', { name: /simulate buy btc/i });
    fireEvent.click(submitBtn);

    // Wait microtask
    await Promise.resolve();

    // Input quantity should NOT be reset
    expect(amountInput.value).toBe('0.05');
  });

  it('does NOT clear quantity when placing limit orders', async () => {
    render(
      <OrderEntryPanel
        selectedTicker={mockBtcTicker}
        orderBook={mockOrderBook}
        connectionStatus="connected"
      />
    );

    const amountInput = screen.getByTestId('order-amount-input') as HTMLInputElement;
    fireEvent.change(amountInput, { target: { value: '0.05' } });

    const submitBtn = screen.getByRole('button', { name: /simulate buy btc/i });
    fireEvent.click(submitBtn);

    // Limit orders do not clear quantity
    expect(amountInput.value).toBe('0.05');
  });

  it('shows neutral empty state with disabled Enter Valid Quantity button and no error alert when quantity is empty', () => {
    render(
      <OrderEntryPanel
        selectedTicker={mockBtcTicker}
        orderBook={mockOrderBook}
        connectionStatus="connected"
      />
    );

    const amountInput = screen.getByTestId('order-amount-input') as HTMLInputElement;
    fireEvent.change(amountInput, { target: { value: '' } });

    // No error alerts should appear
    expect(screen.queryByText(/exceeds available/i)).not.toBeInTheDocument();

    // Button should be disabled with label 'Enter Valid Quantity'
    const submitBtn = screen.getByRole('button', { name: /enter valid quantity/i });
    expect(submitBtn).toBeDisabled();
  });

  it('preserves newly entered quantity if user types during an in-flight async order', async () => {
    let resolveOrder: (val: any) => void;
    const delayedPromise = new Promise((resolve) => {
      resolveOrder = resolve;
    });
    useTradingStore.setState({
      executeMarketOrder: vi.fn().mockImplementation(() => delayedPromise),
    });

    render(
      <OrderEntryPanel
        selectedTicker={mockBtcTicker}
        orderBook={mockOrderBook}
        connectionStatus="connected"
      />
    );

    fireEvent.click(screen.getByRole('button', { name: /^market$/i }));
    const amountInput = screen.getByTestId('order-amount-input') as HTMLInputElement;
    fireEvent.change(amountInput, { target: { value: '0.05' } });

    const submitBtn = screen.getByRole('button', { name: /simulate buy btc/i });
    fireEvent.click(submitBtn);

    // User types a new quantity while order is processing
    fireEvent.change(amountInput, { target: { value: '0.15' } });

    // In-flight order finishes
    await act(async () => {
      resolveOrder!({ success: true });
      await delayedPromise;
    });

    // The newly typed value '0.15' must NOT be overwritten
    expect(amountInput.value).toBe('0.15');
  });

  it('switches to TP / SL mode and allows configuring OCO protection', async () => {
    // Inject BTC position
    useTradingStore.setState({
      positions: {
        BTCUSDT: {
          symbol: 'BTCUSDT',
          baseAsset: 'BTC',
          quoteAsset: 'USDT',
          quantity: 0.1,
          reservedQuantity: 0,
          availableQuantity: 0.1,
          averageEntryPrice: 80000,
          totalCostBasis: 8000,
          realizedPnl: 0,
          openedAt: Date.now(),
          updatedAt: Date.now(),
        },
      },
    });

    render(
      <OrderEntryPanel
        selectedTicker={mockBtcTicker}
        orderBook={mockOrderBook}
        connectionStatus="connected"
      />
    );

    // Switch to TP / SL mode
    act(() => {
      fireEvent.click(screen.getByRole('button', { name: /tp \/ sl/i }));
    });

    expect(screen.getByText(/position protection/i)).toBeInTheDocument();
    expect(screen.getByText(/available to protect:/i)).toBeInTheDocument();

    // Enter protected quantity: 0.05
    const amountInput = screen.getByTestId('protective-amount-input') as HTMLInputElement;
    act(() => {
      fireEvent.change(amountInput, { target: { value: '0.05' } });
    });

    // Enter TP: 85000 (above 81,495 bid)
    const tpInput = screen.getByTestId('tp-price-input') as HTMLInputElement;
    act(() => {
      fireEvent.change(tpInput, { target: { value: '85000' } });
    });

    // Enter SL: 78000 (below 81,495 bid)
    const slInput = screen.getByTestId('sl-price-input') as HTMLInputElement;
    act(() => {
      fireEvent.change(slInput, { target: { value: '78000' } });
    });

    // Submit protection
    const activateBtn = screen.getByTestId('activate-protection-btn');
    expect(activateBtn).not.toBeDisabled();
    expect(activateBtn).toHaveTextContent(/activate linked oco protection/i);

    act(() => {
      fireEvent.click(activateBtn);
    });

    // After submission, store has 2 active protective orders
    await waitFor(() => {
      const protective = useTradingStore.getState().getActiveProtectiveOrders('BTCUSDT');
      expect(protective).toHaveLength(2);
    });

    // And position locked 0.05 BTC
    const pos = useTradingStore.getState().getPosition('BTCUSDT')!;
    expect(pos.reservedQuantity).toBe(0.05);
    expect(pos.availableQuantity).toBe(0.05);
  });

  it('T12: enforces 8-decimal limit, price precision, and $1.00 min notional in UI submit button', () => {
    // Seed portfolio with 0.1 BTC available to sell
    useTradingStore.setState({
      positions: {
        BTCUSDT: {
          symbol: 'BTCUSDT',
          baseAsset: 'BTC',
          quoteAsset: 'USDT',
          quantity: 0.1,
          reservedQuantity: 0,
          availableQuantity: 0.1,
          averageEntryPrice: 80000,
          totalCostBasis: 8000,
          realizedPnl: 0,
          openedAt: Date.now(),
          updatedAt: Date.now(),
        },
      },
    });

    render(
      <OrderEntryPanel
        selectedTicker={mockBtcTicker}
        orderBook={mockOrderBook}
        connectionStatus="connected"
      />
    );

    // Switch to SELL BTC
    fireEvent.click(screen.getByRole('button', { name: /^sell btc$/i }));

    const priceInput = screen.getByTestId('order-price-input') as HTMLInputElement;
    const amountInput = screen.getByTestId('order-amount-input') as HTMLInputElement;
    const submitBtn = screen.getByTestId('submit-order-btn') as HTMLButtonElement;

    // Set Price = 90000
    fireEvent.change(priceInput, { target: { value: '90000' } });

    // 1. Observed test case: Quantity = 0.000000001 BTC (9 decimals)
    fireEvent.change(amountInput, { target: { value: '0.000000001' } });
    expect(submitBtn).toBeDisabled();
    expect(submitBtn).toHaveTextContent('Quantity Max 8 Decimals');

    // 2. Quantity = 0.00001 BTC (8 decimals or less, but 0.00001 * 90000 = $0.90 < $1.00 min notional)
    fireEvent.change(amountInput, { target: { value: '0.00001' } });
    expect(submitBtn).toBeDisabled();
    expect(submitBtn).toHaveTextContent('Min Notional: $1.00 USDT');

    // 3. Price precision violation: 90000.123 (3 decimals for price >= 1)
    fireEvent.change(amountInput, { target: { value: '0.001' } });
    fireEvent.change(priceInput, { target: { value: '90000.123' } });
    expect(submitBtn).toBeDisabled();
    expect(submitBtn).toHaveTextContent('Price Max 2 Decimals');

    // 4. Valid order: Price = 90000, Quantity = 0.001 (notional $90 >= $1, valid precision, within available holding)
    fireEvent.change(priceInput, { target: { value: '90000' } });
    expect(submitBtn).not.toBeDisabled();
    expect(submitBtn).toHaveTextContent('Simulate Sell BTC');
  });
});
