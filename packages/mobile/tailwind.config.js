/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      fontFamily: {
        sans: ['Inter', '-apple-system', 'BlinkMacSystemFont', 'SF Pro Display', 'Segoe UI', 'sans-serif'],
        mono: ['SF Mono', 'Menlo', 'monospace'],
      },
      colors: {
        mobile: {
          bg: '#F8F8FA',
          card: '#FFFFFF',
          accent: '#7c3aed',         // Violet — identite mobile
          'accent-light': '#a78bfa',
          'accent-dark': '#6d28d9',
          success: '#22c55e',
          warning: '#f59e0b',
          danger: '#ef4444',
          text: '#0f172a',
          muted: '#64748b',
          border: '#e2e8f0',
          subtle: '#f1f5f9',
        },
      },
      spacing: {
        'touch': '48px',
        'touch-sm': '40px',
        'touch-lg': '56px',
        'safe-bottom': 'env(safe-area-inset-bottom, 0px)',
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
        'glow-violet': '0 0 20px rgba(124, 58, 237, 0.15)',
      },
      fontSize: {
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
        'scan-line': 'scanSweep 2.5s ease-in-out infinite',
        'scan-flash': 'scanFlash 0.3s ease-out',
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
          '50%': { opacity: '0.6' },
        },
        scanSweep: {
          '0%, 100%': { top: '15%' },
          '50%': { top: '85%' },
        },
        scanFlash: {
          '0%': { opacity: '0.5' },
          '100%': { opacity: '0' },
        },
      },
    },
  },
  plugins: [],
};
