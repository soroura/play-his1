# play-his1 single container: Bun runs the TypeScript server directly (src/main.ts is the entry point; it imports src/server.ts); static client files are in public/ (no build stage).
# Slow, rarely changing steps (dependency install) come BEFORE the COPY of app code, so a code-only deploy reuses cached layers.
FROM oven/bun:1.4.2-alpine
WORKDIR /srv/play

# Dependencies. The app has no runtime dependencies (dev dependencies only), so this layer is normally a no-op.
# bun.lock is optional: the glob copies it only when it exists (package.json always matches, so the COPY cannot fail).
# - package.json declares "dependencies": install production deps, frozen when a lockfile exists.
# - package.json has no "dependencies": skip the install entirely (nothing to fetch, nothing that can fail at deploy time).
COPY package.json bun.lock* tsconfig.json ./
RUN if grep -q '"dependencies"' package.json; then \
      if [ -f bun.lock ]; then bun install --production --frozen-lockfile; else bun install --production; fi; \
    else \
      echo "no runtime dependencies: skipping bun install"; \
    fi

COPY src src
COPY public public
COPY content content

# The release SHA is baked in at build time (deploy.sh -> compose build args), not set at container start.
ARG RELEASE_SHA=unknown
ENV NODE_ENV=production PORT=8098 PLAY_DB=/data/play.sqlite RELEASE_SHA=$RELEASE_SHA
EXPOSE 8098
RUN mkdir -p /data && chown -R bun:bun /data
USER bun
CMD ["bun", "src/main.ts"]
