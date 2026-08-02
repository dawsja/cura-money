# syntax=docker/dockerfile:1.7
# =============================================================================
# Cura Money — single-image build.
#
# Single image, two modes via the dev override (docker-compose.override.yml):
#   - dev:    `target: builder`, `bun run --watch src/index.ts`
#   - prod:   `target: runtime`, `bun run src/index.ts` (distroless, non-root)
#
# Strategy:
#   - Builder stage installs root + UI deps, builds the Vite SPA into
#     ./public (one stage, no server bundle needed).
#   - Runtime stage is distroless + Bun. It runs the .ts file directly
#     via `bun run`, so we don't have to bundle the server at all — that
#     sidesteps the entire class of "bun's bundler follows an optional
#     devDep chain and explodes" problems (e.g. @mapbox/node-pre-gyp →
#     mock-aws-s3 / aws-sdk / nock).
#   - node_modules is shipped in the runtime so every native-binary /
#     CJS-with-dynamic-require dep resolves at boot.
# =============================================================================

# ---- Builder (used in dev; also produces UI artifacts for runtime) --------
FROM oven/bun:1.3 AS builder
WORKDIR /app

# Root deps (server)
COPY package.json bun.lock* ./
RUN bun install --frozen-lockfile

# UI deps + Vite build
COPY src/ui/package.json src/ui/
COPY src/ui/tsconfig.json src/ui/tsconfig.node.json src/ui/vite.config.ts src/ui/
RUN cd src/ui && bun install --frozen-lockfile
COPY src/ui/ src/ui/
RUN cd src/ui && bun run build

# Copy full source tree (needed for dev; runtime stage cherry-picks below)
COPY . .

# ---- Runtime (used in prod; distroless, no shell) -----------------------
FROM gcr.io/distroless/base-debian12 AS runtime
WORKDIR /app

# Bun runtime + project files
COPY --from=builder /usr/local/bin/bun /usr/local/bin/bun
COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/bun.lock ./bun.lock
COPY --from=builder /app/tsconfig.json ./tsconfig.json
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/src ./src
COPY --from=builder /app/drizzle ./drizzle
COPY --from=builder /app/public ./public

# Non-root user (distroless has nobody:65534)
USER 65534:65534

ENV NODE_ENV=production
ENV PORT=3000

EXPOSE 3000

# Run TypeScript directly. Bun transpiles on the fly; no bundle step.
# Healthcheck is in compose, not here (distroless has no shell for CMD).
ENTRYPOINT ["bun", "run", "src/index.ts"]
