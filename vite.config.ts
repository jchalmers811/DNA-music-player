import { defineConfig } from 'vitest/config';

export default defineConfig({
  // Relative asset paths so the build works from any sub-path, e.g. GitHub Pages at /<repo>/.
  base: './',
  // three.js + Tone.js make one ~750 kB chunk (~195 kB gzipped); fine for now.
  build: { chunkSizeWarningLimit: 900 },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
});
