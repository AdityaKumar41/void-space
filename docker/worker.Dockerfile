# ---------------------------------------------------------------------------
# BullMQ worker image (SRS §3.10, §9.2). Runs every queue processor plus the
# chain event listener; concurrency is tuned per queue via env (NFR-SCAL.2).
# ---------------------------------------------------------------------------
FROM node:24-alpine AS base
RUN npm install --global pnpm@9.15.9 && apk add --no-cache libc6-compat openssl
WORKDIR /app
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH

FROM base AS deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml turbo.json tsconfig.base.json .npmrc ./
COPY apps/api/package.json ./apps/api/package.json
COPY apps/worker/package.json ./apps/worker/package.json
COPY packages/db/package.json ./packages/db/package.json
COPY packages/types/package.json ./packages/types/package.json
COPY packages/config/package.json ./packages/config/package.json
COPY packages/ai/package.json ./packages/ai/package.json
COPY packages/storage/package.json ./packages/storage/package.json
RUN pnpm install --frozen-lockfile

FROM deps AS runtime
COPY . .
RUN pnpm --filter @void-space/db generate

ENV NODE_ENV=production
# Shared staging directory used by both API and worker.
ENV STAGING_DIR=/var/lib/void-space/uploads/staging
RUN mkdir -p /var/lib/void-space/uploads \
  && addgroup -S void && adduser -S void -G void \
  && chown -R void:void /var/lib/void-space
USER void

CMD ["pnpm", "--filter", "@void-space/worker", "start"]
