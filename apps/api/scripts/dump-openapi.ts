/** Writes the OpenAPI document generated from the zod schemas (input for packages/api-client). */
import { writeFile } from 'node:fs/promises';
import { FakeQueue } from '../src/jobs/queue';
import { buildApp } from '../src/http/app';
import { createContext } from '../src/bootstrap';
import { loadEnv } from '../src/env';

const out = process.argv[2] ?? 'openapi.json';
const env = loadEnv({ ...process.env, APP_ENV: 'development', ADMIN_API_KEY: 'x', LOG_LEVEL: 'silent' });
const ctx = createContext(new FakeQueue(), env);
const app = await buildApp(ctx, { logger: false });
await app.ready();
await writeFile(out, `${JSON.stringify(app.swagger(), null, 2)}\n`);
await app.close();
await ctx.pool.end();
process.stdout.write(`wrote ${out}\n`);
