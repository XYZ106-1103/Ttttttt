# PROJECT WORLD — game server image (serves the built web client, the account API and the
# WebSocket game connection on one port).
#
#   docker build -t project-world .
#   docker compose up        (server + PostgreSQL, see docker-compose.yml)
#
# Behind a TLS-intercepting proxy, pass its CA certificate as a build secret:
#   docker build --secret id=ca,src=/path/to/ca.crt -t project-world .

# --- Build: client bundle, server bundle, production dependencies ---------------------------
FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
COPY apps/client/package.json apps/client/
COPY apps/server/package.json apps/server/
COPY packages/shared/package.json packages/shared/
RUN --mount=type=secret,id=ca,required=false \
    if [ -f /run/secrets/ca ]; then export NODE_EXTRA_CA_CERTS=/run/secrets/ca; fi \
 && corepack enable && pnpm install --frozen-lockfile
COPY . .
RUN --mount=type=secret,id=ca,required=false \
    if [ -f /run/secrets/ca ]; then export NODE_EXTRA_CA_CERTS=/run/secrets/ca; fi \
 && pnpm --filter @world/client build \
 && pnpm --filter @world/server build \
 && pnpm --filter @world/server deploy --prod --legacy /out

# --- Runtime -------------------------------------------------------------------------------
FROM node:22-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=8787 \
    STATIC_DIR=/app/public
COPY --from=build /out/node_modules ./node_modules
COPY --from=build /app/apps/server/dist ./dist
COPY --from=build /app/apps/client/dist ./public
USER node
EXPOSE 8787
HEALTHCHECK --interval=15s --timeout=3s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+process.env.PORT+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "--enable-source-maps", "dist/server.mjs"]
