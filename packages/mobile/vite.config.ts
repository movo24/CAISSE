import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const useHttps = process.env.VITE_HTTPS === '1';

export default defineConfig(async () => {
  const plugins: any[] = [react()];

  if (useHttps) {
    const basicSsl = (await import('@vitejs/plugin-basic-ssl')).default;
    plugins.push(basicSsl());
  }

  return {
    plugins,
    server: {
      port: 5175,
      host: true,
      ...(useHttps ? { https: {} } : {}),
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
