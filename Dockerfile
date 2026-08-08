# syntax=docker/dockerfile:1

# Harper Middle Bro — shared desk image.
#
# One container, one persistent volume. The desk keeps its whole record (SQLite
# database, filed document bytes, private contact overlays) under DESK_DATA_DIR,
# so the volume is the only durable state and the image stays disposable.
#
# Both Clerk keys are runtime configuration, verified: a server started with
# only NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY in its environment serves the key to
# the browser and redirects to the right Clerk domain. Nothing Clerk-specific is
# baked into the image, so rotating the Clerk app is a restart, not a rebuild.
#
# Build:  docker build -t harper-middle-bro .
# Run:    docker run -p 3000:3000 -v desk-data:/data \
#           -e NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=pk_test_... \
#           -e CLERK_SECRET_KEY=sk_test_... harper-middle-bro

FROM node:22-bookworm-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
# better-sqlite3 v13 ships prebuilt bindings for linux-x64, so no compiler
# toolchain is needed here.
RUN npm ci

FROM node:22-bookworm-slim AS builder
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build

FROM node:22-bookworm-slim AS runner
WORKDIR /app
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    HOSTNAME=0.0.0.0 \
    DESK_DATA_DIR=/data

RUN groupadd --system --gid 1001 nodejs \
    && useradd --system --uid 1001 --gid nodejs nextjs \
    && mkdir -p /data \
    && chown nextjs:nodejs /data

# The standalone bundle carries its own traced node_modules, including
# better-sqlite3 and its linux-x64 prebuild.
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static
COPY --from=builder --chown=nextjs:nodejs /app/public ./public
COPY --chown=nextjs:nodejs docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
RUN chmod +x /usr/local/bin/docker-entrypoint.sh

EXPOSE 3000
VOLUME ["/data"]

HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

# Starts as root only long enough to hand the mounted volume to the app user.
ENTRYPOINT ["/usr/local/bin/docker-entrypoint.sh"]
CMD ["node", "server.js"]
