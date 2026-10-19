/** @type {import('tailwindcss').Config} */
export default {
  darkMode: ['class'],
  content: [
    './index.html',
    './src/**/*.{js,ts,jsx,tsx}',
  ],
  theme: {
    container: {
      center: true,
      padding: '1rem',
      screens: {
        '2xl': '1600px',
      },
    },
    extend: {
      colors: {
        background: '#080a10',
        card: {
          DEFAULT: '#0f1420',
          elevated: '#151b2a',
          hover: '#1a2235',
        },
        border: {
          DEFAULT: '#1e273a',
          muted: '#182030',
          highlight: '#2c3852',
        },
        trade: {
          buy: '#10b981',
          'buy-muted': 'rgba(16, 185, 129, 0.15)',
          'buy-border': 'rgba(16, 185, 129, 0.35)',
          sell: '#f43f5e',
          'sell-muted': 'rgba(244, 63, 94, 0.15)',
          'sell-border': 'rgba(244, 63, 94, 0.35)',
        },
        terminal: {
          muted: '#64748b',
          text: '#94a3b8',
          bright: '#f1f5f9',
          accent: '#38bdf8',
          gold: '#f59e0b',
        },
      },
      fontFamily: {
        mono: ['JetBrains Mono', 'Fira Code', 'Menlo', 'Monaco', 'Courier New', 'monospace'],
        sans: ['Inter', 'system-ui', '-apple-system', 'sans-serif'],
      },
      keyframes: {
        'price-up': {
          '0%': { backgroundColor: 'rgba(16, 185, 129, 0.35)' },
          '100%': { backgroundColor: 'transparent' },
        },
        'price-down': {
          '0%': { backgroundColor: 'rgba(244, 63, 94, 0.35)' },
          '100%': { backgroundColor: 'transparent' },
        },
        'pulse-subtle': {
          '0%, 100%': { opacity: '1' },
          '50%': { opacity: '0.4' },
        },
      },
      animation: {
        'price-up': 'price-up 1s ease-out',
        'price-down': 'price-down 1s ease-out',
        'pulse-subtle': 'pulse-subtle 2s cubic-bezier(0.4, 0, 0.6, 1) infinite',
      },
    },
  },
  plugins: [],
};
