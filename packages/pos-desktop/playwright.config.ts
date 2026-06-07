import { defineConfig, devices } from '@playwright/test';

/**
 * Playwright — tests UI bout-en-bout du parcours caisse critique.
 *
 * Prérequis (voir e2e/README.md) :
 *  - backend lancé sur http://localhost:3001 avec données seed
 *  - le serveur Vite est démarré automatiquement par `webServer` ci-dessous
 *    (réutilise une instance déjà ouverte si présente).
 *
 * Le front pointe vers le backend local via VITE_API_URL (sinon il viserait
 * l'API de prod — cf. src/renderer/utils/apiConfig.ts).
 */
const PORT = Number(process.env.E2E_PORT || 5175);

export default defineConfig({
  testDir: './e2e',
  timeout: 45_000,
  expect: { timeout: 12_000 },
  retries: process.env.CI ? 1 : 0,
  reporter: [['list']],
  use: {
    baseURL: `http://localhost:${PORT}`,
    headless: true,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },
  webServer: {
    command: `VITE_API_URL=http://localhost:3001 npx vite --port ${PORT} --strictPort`,
    url: `http://localhost:${PORT}`,
    reuseExistingServer: true,
    timeout: 60_000,
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
});
