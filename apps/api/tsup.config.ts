import { defineConfig } from 'tsup';
export default defineConfig({
  entry: ['src/server.ts', 'src/worker.ts', 'src/db/migrate-cli.ts', 'src/db/seed-cli.ts'],
  format: ['esm'],
  platform: 'node',
  target: 'node22',
  sourcemap: true,
  clean: true,
  noExternal: [/^@varsling\//],
});
