# Deployment preparation

The development stack is not a public deployment. Use `docker-compose.production.yml` with a dedicated ignored `.env.production`. It uses external PostgreSQL, Redis and S3 and exposes only the web port on loopback for your HTTPS reverse proxy. API calls use the internal API container; no database, Redis, worker or private bucket endpoint needs to be public.

## Required host configuration

1. Pick the deployment host and public HTTPS origin; provision persistent PostgreSQL, Redis and private S3 storage with backups. A single free server may run these services if it has enough storage and memory; GitHub Pages alone cannot run this app.
2. Copy `.env.production.example` to `.env.production`. Configure three database roles: schema migration owner, tenant runtime `void_app` without RLS bypass, and narrowly granted identity/platform `void_platform`. `migrate` applies schema migrations and grants/RLS before the application starts. If managed PostgreSQL disallows role creation, pre-provision these roles with your administrator. Do not run the demo seed in production: migrations install required role definitions without demo users/assets.
3. Configure independent random JWT secrets, a real HTTPS origin, matching CORS and private S3 configuration. Keep cookies secure. Store credentials in your host's secrets mechanism or the ignored env file, never source control.
4. Configure the existing text provider or OpenRouter for agent generation. Keep images disabled until their provider works. BullMQ is the production template's default; select Inngest only after configuring a production Inngest service, signing key and event key, and its signed callback to `worker:4030/api/inngest`. A local dev server is not the production runtime.
5. Register production HTTPS callbacks with Sketchfab/Google before enabling each integration. A localhost OAuth callback cannot service a public deployment. Preserve Sketchfab attribution and licensing.
6. Run `pnpm deploy:check`. This validates configuration without printing secrets; it does not claim external credentials work.
7. Build and start with `docker compose -f docker-compose.production.yml up -d --build`. Run through your host's HTTPS reverse proxy to `127.0.0.1:3000`. Provider-managed certificates or a maintained host proxy are required; do not deploy the development certificate as public TLS.
8. Verify `/api/v1/health`, sign-up/sign-in, private upload, agent generation, annotation editing, saved history/resume, public/private lesson access and relevant OAuth callbacks on the actual domain. Create the first central administrator from an existing verified account using the bootstrap script, then enroll MFA. Existing installations should retain their administrator record, not bootstrap again.

## Existing data

Back up and restore PostgreSQL, S3 objects, and any remaining in-flight uploads to the target environment. Keep the bucket's key layout; content identifiers and lesson references remain stable. Use `scripts/migrate-asset-storage.mts` to verify migrated asset objects before enabling traffic. Never copy local demo credentials into a fresh public installation.

## Optional features

Chain publishing requires a Fuji RPC, publisher and deployment of the current registry supporting HTTPS metadata URIs. It is explicitly disabled when absent. Historical tokens cannot be upgraded by editing source. Image generation and live paid checkout remain outside this release.

## Build isolation

`.dockerignore` excludes credentials, all nested staging directories, backups, local models, database/generated artifacts, checkpoints and development build output. Docker generates the correct Linux Prisma engine itself. Build manifests use pinned pnpm and Node 24. No image is pushed by building locally.

## Readiness boundary

Passing local tests and image builds establishes software/package readiness. Public readiness additionally requires the target origin, real deployment credentials, persistent services, successful callback registration and a smoke test on that host. These must be verified before stating that every integration is live.
