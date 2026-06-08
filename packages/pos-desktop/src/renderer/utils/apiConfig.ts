// Centralized API URL detection — works in Vite dev, Electron desktop,
// and Capacitor (iPad).
//
// Priority: VITE_API_URL env var > desktop/Capacitor detection > localhost proxy.
//
// In the packaged desktop app the page is served from the app:// protocol
// (window.posDesktop is injected by the Electron preload), so there is no
// dev proxy — it MUST talk to the real API. VITE_API_URL can still override.

const isCapacitor =
  typeof window !== 'undefined' && typeof (window as any).Capacitor !== 'undefined';

const isDesktop =
  typeof window !== 'undefined' && (window as any).posDesktop?.isDesktop === true;

const isLocalhost =
  typeof window !== 'undefined' && window.location.hostname.includes('localhost');

const IS_PROD = isCapacitor || isDesktop || (typeof window !== 'undefined' && !isLocalhost);

// Default production API endpoint. Overridable at build time via VITE_API_URL
// (see .env.example) so dev / staging / prod can each point elsewhere.
const DEFAULT_PROD_API = 'https://api.addxintelligence.com';

export const API_URL =
  import.meta.env.VITE_API_URL || (IS_PROD ? DEFAULT_PROD_API : '');
