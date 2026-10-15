# ---- build -----------------------------------------------------------------
# npm traffic goes through a Shieldoo Gate pull-through proxy when the token is passed as a
# BuildKit secret, and straight to registry.npmjs.org otherwise:
#   docker build --secret id=sgw_token,env=SGW_TOKEN -t reviewer .
# A secret, not a build arg: build-arg values end up in the image history.
# SGW_USER is the Basic-auth username, which the gate reads as the project label.
ARG SGW_USER=reviewer
ARG SGW_HOST=shieldoo-gate.cloudfield.cz

FROM node:22-alpine AS build
ARG SGW_USER
ARG SGW_HOST
WORKDIR /app
# better-sqlite3 ships prebuilt binaries for alpine/musl; toolchain only as a fallback.
RUN apk add --no-cache python3 make g++
COPY package.json package-lock.json ./
# npm rewrites the registry host of the lockfile's `resolved` URLs to the configured registry,
# so the locked tree installs through the gate without touching package-lock.json.
RUN --mount=type=secret,id=sgw_token \
    if [ -s /run/secrets/sgw_token ]; then \
        npm config set registry "https://npm.${SGW_HOST}/" && \
        npm config set "//npm.${SGW_HOST}/:_auth" \
            "$(printf '%s:%s' "${SGW_USER}" "$(cat /run/secrets/sgw_token)" | base64 | tr -d '\n')"; \
    fi; \
    npm ci && npm config delete "//npm.${SGW_HOST}/:_auth"
COPY . .
RUN npm run build && npm prune --omit=dev

# ---- runtime ---------------------------------------------------------------
FROM node:22-alpine
ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=4321 \
    DATABASE_PATH=/data/reviewer.db
WORKDIR /app
# The app runs on plain `node`; npm, corepack and yarn only add CVEs to the published image.
RUN apk upgrade --no-cache && apk add --no-cache curl \
    && rm -rf /usr/local/lib/node_modules/npm /usr/local/lib/node_modules/corepack /opt/yarn-* \
              /usr/local/bin/npm /usr/local/bin/npx /usr/local/bin/corepack \
              /usr/local/bin/yarn /usr/local/bin/yarnpkg \
    && mkdir -p /data && chown node:node /data
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
