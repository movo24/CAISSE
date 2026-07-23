import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  test: {
    // Environnement par défaut : node (tests de fonctions pures).
    // Les tests de composants déclarent `// @vitest-environment jsdom` en tête.
    environment: 'node',
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
  },
});
