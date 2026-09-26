# ---------------------------------------------------------------------------
# VOID·STUDIO API image (VS2-SRS-1.0 §6.4, §9.2).
#
# The containerized alternative to `pnpm studio:dev`; the native path is the primary
# developer loop. Only the *control plane* is in here. The editor is not, and cannot be:
# building the fork needs emsdk + cmake + ninja + clang for sculptcore (see
# apps/studio-web/VENDOR.md), which is a different image and a different problem.
#
# Its own file rather than a reuse of docker/api.Dockerfile: the two services share no
# workspace package, so one image would install both products into one container and put
# VOID·SPACE's dependencies in a VOID·STUDIO process — the opposite of §3.1's separation.
#
# Known cost, shared with the other three images: the build context is the whole
# repository, so the image is far larger than this service needs. Shrinking it means a
# .dockerignore, which changes all four builds at once and is therefore its own change.
# ---------------------------------------------------------------------------
FROM node:20-alpine AS base
RUN corepack enable && apk add --no-cache libc6-compat openssl curl
WORKDIR /app
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH

# ---- dependencies (cached on the lockfile) --------------------------------
# Only the workspace members this service's dependency graph reaches are copied. pnpm
# resolves the members that are present, so the rest of the monorepo stays out of this
# layer and a change to VOID·SPACE's source cannot invalidate the image.
FROM base AS deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml turbo.json tsconfig.base.json .npmrc ./
COPY apps/studio-api/package.json ./apps/studio-api/package.json
COPY packages/studio-db/package.json ./packages/studio-db/package.json
COPY packages/studio-engine/package.json ./packages/studio-engine/package.json
COPY packages/voidspace-client/package.json ./packages/voidspace-client/package.json
COPY packages/types/package.json ./packages/types/package.json
RUN pnpm install --frozen-lockfile

# ---- runtime --------------------------------------------------------------
FROM deps AS runtime
COPY . .
# The Prisma client is generated, never committed — `packages/studio-db/generated/` is in
# .gitignore. Without this the service cannot even import `@void-space/studio-db`. It also
# has to happen *after* the copy, so the query engine matches this image's platform rather
# than the developer's.
RUN pnpm --filter @void-space/studio-db generate

ENV NODE_ENV=production
# 4100 — matching `$studio_api_upstream` in docker/studio/nginx.conf and the env default. A
# mismatch between any two of those three is a 502 that looks like the API being down.
ENV STUDIO_API_PORT=4100
EXPOSE 4100

# Non-root runtime user (§2.5 minimises the local attack surface).
RUN addgroup -S void && adduser -S void -G void && chown -R void:void /app
USER void

# The Studio's own health route, which also reports whether VOID·SPACE is reachable — so a
# container that is up but cut off from the platform it publishes into is visible here.
HEALTHCHECK --interval=15s --timeout=5s --start-period=20s --retries=5 \
  CMD curl -fsS http://localhost:4100/studio/api/v1/health || exit 1

CMD ["pnpm", "--filter", "@void-space/studio-api", "start"]
