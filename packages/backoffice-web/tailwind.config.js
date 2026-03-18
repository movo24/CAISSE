import typography from '@tailwindcss/typography';

/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      fontFamily: {
        sans: ['Inter', '-apple-system', 'BlinkMacSystemFont', 'SF Pro Display', 'Segoe UI', 'sans-serif'],
        mono: ['JetBrains Mono', 'SF Mono', 'Menlo', 'monospace'],
      },
      colors: {
        bo: {
          bg: 'var(--bo-bg)',
          card: 'var(--bo-card)',
          accent: 'var(--bo-accent)',
          'accent-light': 'var(--bo-accent-light)',
          success: 'var(--bo-success)',
          warning: 'var(--bo-warning)',
          danger: 'var(--bo-danger)',
          text: 'var(--bo-text)',
          muted: 'var(--bo-muted)',
          border: 'var(--bo-border)',
          subtle: 'var(--bo-subtle)',
          sidebar: 'var(--bo-sidebar)',
          'sidebar-hover': 'var(--bo-sidebar-hover)',
          'sidebar-active': 'var(--bo-accent)',
        },
      },
      borderRadius: {
        xl: '12px',
        '2xl': '16px',
        '3xl': '24px',
      },
      boxShadow: {
        soft: '0 1px 3px 0 rgba(0, 0, 0, 0.04), 0 1px 2px -1px rgba(0, 0, 0, 0.03)',
        card: '0 2px 8px -2px rgba(0, 0, 0, 0.06), 0 1px 3px -1px rgba(0, 0, 0, 0.04)',
        elevated: '0 8px 24px -8px rgba(0, 0, 0, 0.1)',
      },
      keyframes: {
        'fade-in': {
          from: { opacity: '0', transform: 'translateY(8px)' },
          to: { opacity: '1', transform: 'translateY(0)' },
        },
        'slide-up': {
          from: { opacity: '0', transform: 'translateY(16px)' },
          to: { opacity: '1', transform: 'translateY(0)' },
        },
      },
      animation: {
        'fade-in': 'fade-in 0.3s ease-out',
        'slide-up': 'slide-up 0.4s ease-out',
      },
    },
  },
  plugins: [typography],
};
