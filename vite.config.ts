import { defineConfig } from 'vitest/config';

export default defineConfig({
  // Chemins relatifs : le build fonctionne aussi servi depuis un sous-dossier.
  base: './',
  server: { host: true, port: 5173 },
  preview: { host: true, port: 4173 },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
  },
});
