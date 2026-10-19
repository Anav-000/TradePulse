import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { PortfolioEquityChart } from './PortfolioEquityChart';
import { EquitySnapshot } from '@/features/trading/types';

describe('PortfolioEquityChart Component', () => {
  const baseTimestamp = 1700000000000;

  it('renders baseline state when 1 snapshot is provided without fabricating points', () => {
    const singleSnapshot: EquitySnapshot[] = [
      {
        id: 'snap_1',
        timestamp: baseTimestamp,
        totalEquity: 50000,
        availableUsdt: 50000,
        investedValue: 0,
        unrealizedPnl: 0,
        realizedPnl: 0,
      },
    ];

    render(
      <PortfolioEquityChart
        equitySnapshots={singleSnapshot}
        currentEquity={50000}
        startingCapital={50000}
      />
    );

    expect(screen.getByText('Baseline Equity Initialized')).toBeInTheDocument();
    expect(screen.getByText(/Snapshots are genuinely sampled/i)).toBeInTheDocument();
    expect(screen.getAllByText('$50,000.00').length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText('0.00%')).toBeInTheDocument();
  });

  it('dynamically scales Y-axis for small portfolio fluctuations (e.g. -$1.24 on $50,000)', () => {
    const snapshotsWithSmallDelta: EquitySnapshot[] = [
      {
        id: 'snap_1',
        timestamp: baseTimestamp,
        totalEquity: 50000.00,
        availableUsdt: 50000.00,
        investedValue: 0,
        unrealizedPnl: 0,
        realizedPnl: 0,
      },
      {
        id: 'snap_2',
        timestamp: baseTimestamp + 60000,
        totalEquity: 49998.76, // -$1.24 fee
        availableUsdt: 41845.92,
        investedValue: 8152.84,
        unrealizedPnl: 0,
        realizedPnl: 0,
      },
    ];

    render(
      <PortfolioEquityChart
        equitySnapshots={snapshotsWithSmallDelta}
        currentEquity={49998.76}
        startingCapital={50000.00}
      />
    );

    // Performance summary banner displays -$1.24 net P&L
    expect(screen.getByText('-$1.24')).toBeInTheDocument();
    expect(screen.getByText('$49,998.76')).toBeInTheDocument();

    // Chart container is rendered
    const container = screen.getByTestId('portfolio-equity-chart-container');
    expect(container).toBeInTheDocument();

    // Max and Min Y-axis labels are visible and tightly padded around the $1.24 change
    // rather than squashed flat over thousands of dollars
    expect(screen.getByText('$50,000.50')).toBeInTheDocument();
    expect(screen.getByText('$49,998.26')).toBeInTheDocument();
  });

  it('renders interactive crosshair and tooltip when hovering over points', () => {
    const snapshots: EquitySnapshot[] = [
      {
        id: 'snap_1',
        timestamp: baseTimestamp,
        totalEquity: 50000.00,
        availableUsdt: 50000.00,
        investedValue: 0,
        unrealizedPnl: 0,
        realizedPnl: 0,
      },
      {
        id: 'snap_2',
        timestamp: baseTimestamp + 60000,
        totalEquity: 50250.00, // +$250 profit
        availableUsdt: 42000.00,
        investedValue: 8250.00,
        unrealizedPnl: 250,
        realizedPnl: 0,
      },
      {
        id: 'snap_3',
        timestamp: baseTimestamp + 120000,
        totalEquity: 50400.00, // +$400 profit
        availableUsdt: 42000.00,
        investedValue: 8400.00,
        unrealizedPnl: 400,
        realizedPnl: 0,
      },
    ];

    render(
      <PortfolioEquityChart
        equitySnapshots={snapshots}
        currentEquity={50400.00}
        startingCapital={50000.00}
      />
    );

    const container = screen.getByTestId('portfolio-equity-chart-container');

    // Mock getBoundingClientRect
    container.getBoundingClientRect = () => ({
      left: 0,
      top: 0,
      right: 300,
      bottom: 100,
      width: 300,
      height: 100,
      x: 0,
      y: 0,
      toJSON: () => {},
    });

    // Hover near middle point (x = 150 of 300 -> ratio 0.5 -> index 1)
    fireEvent.mouseMove(container, { clientX: 150 });

    // Crosshair and tooltip should appear
    expect(screen.getByTestId('equity-chart-crosshair')).toBeInTheDocument();
    expect(screen.getByTestId('equity-chart-tooltip')).toBeInTheDocument();

    // Tooltip should contain snapshot 2 details
    expect(screen.getByText('Snapshot #2')).toBeInTheDocument();
    expect(screen.getAllByText('$50,250.00').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('+$250.00').length).toBeGreaterThanOrEqual(1);

    // Mouse leave removes crosshair and tooltip
    fireEvent.mouseLeave(container);
    expect(screen.queryByTestId('equity-chart-crosshair')).not.toBeInTheDocument();
    expect(screen.queryByTestId('equity-chart-tooltip')).not.toBeInTheDocument();
  });
});
