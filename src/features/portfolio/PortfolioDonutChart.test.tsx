import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { PortfolioDonutChart, DonutChartItem } from './PortfolioDonutChart';

describe('PortfolioDonutChart Component', () => {
  const sampleItems: DonutChartItem[] = [
    {
      id: 'USDT',
      label: 'USDT (Cash)',
      value: 30000,
      percent: 60,
      color: '#10b981',
      isCash: true,
    },
    {
      id: 'BTCUSDT',
      label: 'BTC (BTCUSDT)',
      value: 20000,
      percent: 40,
      color: '#06b6d4',
    },
  ];

  it('renders SVG donut slices and total equity center text', () => {
    const { container } = render(
      <PortfolioDonutChart items={sampleItems} totalEquity={50000} />
    );

    // Should render SVG paths for the 2 slices
    const paths = container.querySelectorAll('svg path');
    expect(paths.length).toBe(2);

    // Total equity rendered in center
    expect(screen.getByText('Total Equity')).toBeInTheDocument();
    expect(screen.getByText('$50,000.00')).toBeInTheDocument();
    expect(screen.getByText('2 assets')).toBeInTheDocument();

    // Breakdown list rendered
    expect(screen.getByText('USDT (Cash)')).toBeInTheDocument();
    expect(screen.getByText('BTC (BTCUSDT)')).toBeInTheDocument();
    expect(screen.getByText('(60.0%)')).toBeInTheDocument();
    expect(screen.getByText('(40.0%)')).toBeInTheDocument();
  });

  it('updates center text when hovering over a slice or legend item', () => {
    const { container } = render(
      <PortfolioDonutChart items={sampleItems} totalEquity={50000} />
    );

    const paths = container.querySelectorAll('svg path');
    expect(paths.length).toBe(2);

    // Hover first slice (USDT)
    fireEvent.mouseEnter(paths[0]);

    expect(screen.getAllByText(/USDT \(Cash\)/i).length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('$30,000.00').length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText('+60.00%')).toBeInTheDocument();

    // Unhover
    fireEvent.mouseLeave(paths[0]);
    expect(screen.getByText('Total Equity')).toBeInTheDocument();
  });

  it('renders empty placeholder circle when no items have value', () => {
    const { container } = render(
      <PortfolioDonutChart items={[]} totalEquity={0} />
    );

    const circle = container.querySelector('svg circle');
    expect(circle).toBeInTheDocument();
  });
});
