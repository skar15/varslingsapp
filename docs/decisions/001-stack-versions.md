# 001 Stack versions

Date: 2026-11-04 · Status: accepted

The spec names the tools but not versions. Chosen (latest stable at build time unless noted):

- Node 22, pnpm 10 workspaces, Turborepo 2.
- TypeScript **5.9** (not 7.x): TS 7 is the native port without the JS compiler API that Next.js, Expo and typescript-eslint still use.
- zod 4, Fastify 5, fastify-type-provider-zod 7 (OpenAPI 3.1 from the zod schemas), Drizzle 0.45, pg-boss 12.
- Next.js 16 (App Router, `proxy.ts` for locale routing), React 19.3.0 pinned to the version Expo SDK 58 bundles.
- Expo SDK 58 / React Native 0.88, Expo Router, MapLibre React Native 11.
- `node-linker=hoisted` in `.npmrc`: the most reliable layout for React Native native-module resolution in a pnpm monorepo.
