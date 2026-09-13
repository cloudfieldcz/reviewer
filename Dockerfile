# ---- build -----------------------------------------------------------------
FROM node:22-alpine AS build
WORKDIR /app
# better-sqlite3 ships prebuilt binaries for alpine/musl; toolchain only as a fallback.
RUN apk add --no-cache python3 make g++
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build && npm prune --omit=dev

# ---- runtime ---------------------------------------------------------------
FROM node:22-alpine
ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=4321 \
    DATABASE_PATH=/data/reviewer.db
WORKDIR /app
RUN apk add --no-cache curl && mkdir -p /data && chown node:node /data
COPY --from=build --chown=node:node /app/dist ./dist
COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/drizzle ./drizzle
COPY --from=build --chown=node:node /app/package.json ./package.json
USER node
VOLUME ["/data"]
EXPOSE 4321
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD curl -fsS http://127.0.0.1:4321/api/health || exit 1
CMD ["node", "dist/server/entry.mjs"]
