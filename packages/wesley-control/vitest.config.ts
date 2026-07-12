import { defineConfig } from 'vitest/config';

// Tests target ONLY pure logic modules (src/lib, src/api/contracts) — no
// react-native imports there, so a plain node environment suffices.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
});
