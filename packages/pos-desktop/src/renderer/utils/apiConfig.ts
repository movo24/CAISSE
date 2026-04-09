// Centralized API URL detection — works in Vite dev, Electron, and Capacitor (iPad)
//
// Priority: VITE_API_URL env var > Capacitor detection > localhost proxy

const isCapacitor =
  typeof window !== 'undefined' && typeof (window as any).Capacitor !== 'undefined';

const IS_PROD =
  isCapacitor ||
  (typeof window !== 'undefined' && !window.location.hostname.includes('localhost'));

export const API_URL = import.meta.env.VITE_API_URL || (IS_PROD ? 'https://api.addxintelligence.com' : '');
