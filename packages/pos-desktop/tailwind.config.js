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
          bg: '#F7F7F9',
          card: '#FFFFFF',
          accent: '#E5117A',       // Magenta Wesley officiel — action principale, identité unique
          'accent-deep': '#C40E68',// Magenta enfoncé — hover/active
          'accent-alt': '#00ffcc', // Accent secondaire — highlights
          success: '#16a34a',
          warning: '#f59e0b',
          danger: '#dc2626',
          text: '#111827',         // Noir mat profond
          muted: '#6b7280',
          border: '#e5e7eb',
          subtle: '#f3f4f6',
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
        glow: '0 0 20px rgba(229, 17, 122, 0.15)',
        pay: '0 8px 20px -6px rgba(229, 17, 122, 0.45)',
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
