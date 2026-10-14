# syntax=docker/dockerfile:1.7
#
# One image: the API server plus the built web app on one port.
# The runtime stage only builds once typecheck, lint and tests pass (see `check`).

ARG NODE_IMAGE=node:26-slim

FROM ${NODE_IMAGE} AS base
# Node 25+ ships without corepack; pin pnpm to the repo's packageManager.
RUN npm install --global pnpm@12.11.2
WORKDIR /repo

# Dependencies depend on the lockfile only, so this layer survives code changes.
FROM base AS deps
COPY pnpm-lock.yaml pnpm-workspace.yaml ./
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
    pnpm fetch --store-dir /pnpm/store
COPY . .
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
    pnpm install --offline --frozen-lockfile --store-dir /pnpm/store

FROM deps AS check
RUN pnpm typecheck && pnpm lint && pnpm test && touch /checked

FROM deps AS build
RUN pnpm -F @odjazd/web build && pnpm -F @odjazd/server build
# The one package the bundle leaves external, at the lockfile's version.
RUN mkdir -p /out/node_modules \
    && cp -rL "$(node -p 'const p = require("path"); p.dirname(require.resolve("undici/package.json", { paths: [p.dirname(require.resolve("@effect/platform-node/package.json", { paths: ["apps/server"] }))] }))')" /out/node_modules/undici \
    && cp -r apps/server/dist /out/server \
    && cp -r apps/web/dist /out/web

FROM ${NODE_IMAGE} AS runtime
ENV NODE_ENV=production \
    PORT=8787 \
    ODJAZD_DATA_DIR=/data \
    ODJAZD_WEB_DIR=/app/web
WORKDIR /app
COPY --from=check /checked /tmp/checked
COPY --from=build /out/node_modules ./node_modules
COPY --from=build /out/server ./server
COPY --from=build /out/web ./web
# Compiled feeds; mount a volume here so restarts don't re-ingest.
RUN mkdir -p /data && chown node:node /data
VOLUME /data
USER node
EXPOSE 8787
# The first start downloads and compiles the city's GTFS feed: allow it time.
HEALTHCHECK --interval=30s --timeout=5s --start-period=120s --retries=3 \
    CMD ["node", "-e", "fetch('http://127.0.0.1:' + process.env.PORT + '/api/health').then((r) => process.exit(r.ok ? 0 : 1), () => process.exit(1))"]
CMD ["node", "--enable-source-maps", "server/server.mjs"]
