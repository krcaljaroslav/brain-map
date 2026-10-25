import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  // node_modules je symlink na plugin 4D: cache musí zůstat v tomhle repu, ne v jeho.
  cacheDir: 'tests/.vystup/vite',
  resolve: {
    alias: {
      obsidian: fileURLToPath(new URL('./tests/mocks/obsidian.ts', import.meta.url)),
    },
  },
  test: {
    cache: false,
    include: ['tests/**/*.test.ts'],
    // Kopie repa pro mutace leží v tests/.vystup/mutace, jejich testy sem nepatří.
    exclude: ['**/node_modules/**', 'tests/.vystup/**'],
  },
});
