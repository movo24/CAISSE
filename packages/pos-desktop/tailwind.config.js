/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  darkMode: 'class',
  theme: {
    screens: {
      /* ── Multi-platform breakpoints ──
       *  compact:  iPad 10.2" portrait (810px) / iPad Air (820px)
       *  tablet:   iPad landscape (1080px) / iPad Pro 11" (1194px)
       *  desktop:  Standard monitors (1280px+)
       *  wide:     Large POS monitors (1440px+)
       *  ultrawide: 22"+ displays (1920px+)
       */
      'compact': '640px',
      'tablet': '1024px',
      'desktop': '1280px',
      'wide': '1440px',
      'ultrawide': '1920px',
    },
    extend: {
      fontFamily: {
        sans: ['Inter', '-apple-system', 'BlinkMacSystemFont', 'SF Pro Display', 'Segoe UI', 'sans-serif'],
        mono: ['JetBrains Mono', 'SF Mono', 'Menlo', 'monospace'],
      },
      colors: {
        pos: {
          bg: '#F8F8FA',
          card: '#FFFFFF',
          accent: '#ff007a',       // Accent vif — action principale
          'accent-alt': '#00ffcc', // Accent secondaire — highlights
          success: '#22c55e',
          warning: '#f59e0b',
          danger: '#ef4444',
          text: '#0f172a',         // Noir mat profond
          muted: '#64748b',
          border: '#e2e8f0',
          subtle: '#f1f5f9',
        },
      },
      spacing: {
        /* Touch-friendly spacing */
        'touch': '48px',     // Minimum touch target (Apple HIG 44pt + padding)
        'touch-sm': '40px',
        'touch-lg': '56px',
      },
      borderRadius: {
        xl: '12px',
        '2xl': '16px',
        '3xl': '24px',
        full: '9999px',
      },
      boxShadow: {
        soft: '0 1px 3px 0 rgba(0, 0, 0, 0.04), 0 1px 2px -1px rgba(0, 0, 0, 0.03)',
        card: '0 2px 8px -2px rgba(0, 0, 0, 0.06), 0 1px 3px -1px rgba(0, 0, 0, 0.04)',
        elevated: '0 8px 24px -8px rgba(0, 0, 0, 0.1)',
        glow: '0 0 20px rgba(255, 0, 122, 0.15)',
      },
      fontSize: {
        /* Touch-optimized text sizes */
        'touch-xs': ['14px', { lineHeight: '20px' }],
        'touch-sm': ['16px', { lineHeight: '24px' }],
        'touch-base': ['18px', { lineHeight: '28px' }],
        'touch-lg': ['22px', { lineHeight: '30px' }],
      },
      animation: {
        'slide-up': 'slideUp 0.3s ease-out',
        'fade-in': 'fadeIn 0.2s ease-out',
        'scale-in': 'scaleIn 0.2s ease-out',
        'pulse-soft': 'pulseSoft 2s ease-in-out infinite',
      },
      keyframes: {
        slideUp: {
          from: { opacity: '0', transform: 'translateY(8px)' },
          to: { opacity: '1', transform: 'translateY(0)' },
        },
        fadeIn: {
          from: { opacity: '0' },
          to: { opacity: '1' },
        },
        scaleIn: {
          from: { opacity: '0', transform: 'scale(0.95)' },
          to: { opacity: '1', transform: 'scale(1)' },
        },
        pulseSoft: {
          '0%, 100%': { opacity: '1' },
          '50%': { opacity: '0.7' },
        },
      },
    },
  },
  plugins: [],
};
