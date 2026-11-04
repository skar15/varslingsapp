# Build from the repository root: docker build -f apps/api/Dockerfile .
# One image, two entrypoints: `node dist/server.js` (HTTP) and `node dist/worker.js` (pg-boss worker).
FROM node:22-slim AS build
WORKDIR /repo
RUN corepack enable
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json .npmrc ./
COPY packages/shared/package.json packages/shared/
COPY packages/api-client/package.json packages/api-client/
COPY apps/api/package.json apps/api/
RUN pnpm install --frozen-lockfile --filter @varsling/api...
COPY tsconfig.base.json ./
COPY config config
COPY packages/shared packages/shared
COPY apps/api apps/api
RUN pnpm --filter @varsling/api build && pnpm --filter @varsling/api deploy --prod --legacy /out

FROM node:22-slim
ENV NODE_ENV=production CONFIG_DIR=/app/config
WORKDIR /app
COPY --from=build /out/node_modules ./node_modules
COPY --from=build /repo/apps/api/dist ./dist
COPY --from=build /repo/apps/api/src/db/migrations ./dist/migrations
COPY --from=build /repo/config ./config
USER node
EXPOSE 4000
CMD ["node", "dist/server.js"]
