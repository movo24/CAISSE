// Centralized API URL detection — works in Vite dev, Electron, and Capacitor (iPad)
//
// - Vite dev:    localhost → empty string (proxy handles /api → localhost:3001)
// - Electron:    localhost → empty string (same proxy)
// - Capacitor:   localhost BUT no proxy → must use production URL
// - Production:  any non-localhost → production URL

const isCapacitor =
  typeof window !== 'undefined' && typeof (window as any).Capacitor !== 'undefined';

const IS_PROD =
  isCapacitor ||
  (typeof window !== 'undefined' && !window.location.hostname.includes('localhost'));

export const API_URL = IS_PROD ? 'https://api.addxintelligence.com' : '';
