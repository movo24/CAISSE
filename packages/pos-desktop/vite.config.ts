import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// HTTPS mode: run with VITE_HTTPS=1 npm run dev
// Required for iPad camera (navigator.mediaDevices needs secure context)
// Default: HTTP (works on iPad without certificate issues)
const useHttps = process.env.VITE_HTTPS === '1';

// Desktop (Electron) build: assets are served via the app:// protocol from a
// file root, so asset URLs must be RELATIVE. Web/Vercel build keeps absolute.
const isDesktop = process.env.POS_TARGET === 'desktop';

export default defineConfig(async () => {
  const plugins: any[] = [react()];

  if (useHttps) {
    const basicSsl = (await import('@vitejs/plugin-basic-ssl')).default;
    plugins.push(basicSsl());
  }

  return {
    plugins,
    base: isDesktop ? './' : '/',
    server: {
      port: 5175,
      host: true,
      ...(useHttps ? { https: {} } : {}),
      // Proxy API calls through Vite dev server
      // iPad: http://192.168.x.x:5174/api/... → forwarded to http://localhost:3001/api/...
      // Solves: no need to configure VITE_API_URL, no CORS, no mixed content in HTTPS mode
      proxy: {
        '/api': {
          target: 'http://localhost:3001',
          changeOrigin: true,
          secure: false,
        },
      },
    },
    resolve: {
      alias: {
        '@caisse/shared': '../../shared',
      },
    },
  };
});
