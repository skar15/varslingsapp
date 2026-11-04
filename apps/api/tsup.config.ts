import { defineConfig } from 'tsup';
export default defineConfig({
  entry: { server: 'src/server.ts', worker: 'src/worker.ts', 'migrate-cli': 'src/db/migrate-cli.ts', 'seed-cli': 'src/db/seed-cli.ts' },
  format: ['esm'],
  platform: 'node',
  target: 'node22',
  sourcemap: true,
  clean: true,
  noExternal: [/^@varsling\//],
});
