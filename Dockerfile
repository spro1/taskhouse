# App image: Node LTS running the TypeScript server directly (type stripping), plus the built web app.
FROM docker.io/library/node:26-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN (npm run build --if-present) && npm prune --omit=dev && npm audit --omit=dev --audit-level=low

FROM docker.io/library/node:26-alpine
ARG VERSION=dev
LABEL org.opencontainers.image.title="Taskhouse" org.opencontainers.image.licenses="Apache-2.0" org.opencontainers.image.version="${VERSION}"
WORKDIR /app
ENV NODE_ENV=production DATA_DIR=/data PORT=3000
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/server ./server
COPY --from=build /app/package.json ./
COPY --from=build /app/dist* ./dist/
# Patched OS packages and no package managers at runtime (npm, corepack and yarn carry most of the base image's CVEs).
RUN apk upgrade --no-cache \
 && rm -rf /usr/local/lib/node_modules/npm /usr/local/lib/node_modules/corepack /opt/yarn-* \
           /usr/local/bin/npm /usr/local/bin/npx /usr/local/bin/corepack /usr/local/bin/yarn /usr/local/bin/yarnpkg \
 && rm -f server/*.test.ts server/testdb.ts && mkdir -p /data && chown node:node /data \
 # A file in /tmp keeps the directory (mode 1777) when alpine-baselayout, which owns it, is removed below.
 && touch /tmp/.keep \
 # Node bundles its own OpenSSL; busybox (shell, wget) and the system OpenSSL only serve apk, and carry unfixed CVEs.
 # Nothing at runtime needs a shell: CMD and HEALTHCHECK are exec form.
 && apk del --no-cache --force-broken-world ssl_client libssl3 libcrypto3 busybox busybox-binsh alpine-baselayout apk-tools libapk
USER node
VOLUME /data
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s CMD ["node", "-e", "fetch('http://127.0.0.1:3000/healthz').then((r) => process.exit(r.ok ? 0 : 1), () => process.exit(1))"]
# The base image's entrypoint is a shell script; there is no shell here.
ENTRYPOINT ["node"]
CMD ["server/index.ts"]
