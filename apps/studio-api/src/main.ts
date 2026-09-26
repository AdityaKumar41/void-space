/**
 * Process lifecycle for the Studio API: validate configuration, run preflight checks,
 * serve, and shut down cleanly on SIGINT/SIGTERM so the connection pools are released
 * rather than left half-open.
 */
import { disconnectStudioClients } from '@void-space/studio-db';

import { buildStudioApp, preflightStudio } from './app';
import { loadEnv } from './env';

export async function main(): Promise<void> {
  const env = loadEnv();

  const warnings = await preflightStudio(env);
  const { app, bridge } = await buildStudioApp(env);

  for (const warning of warnings) app.log.info(`preflight: ${warning}`);

  const shutdown = async (signal: string): Promise<void> => {
    app.log.info(`${signal} received — shutting down`);
    try {
      await app.close();
      await disconnectStudioClients();
      process.exit(0);
    } catch (error) {
      app.log.error({ err: error }, 'shutdown failed');
      process.exit(1);
    }
  };

  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));

  await app.listen({ port: env.STUDIO_API_PORT, host: '0.0.0.0' });
  app.log.info(
    `VOID·STUDIO API listening on :${env.STUDIO_API_PORT} (${env.NODE_ENV}) — ` +
      `VOID·SPACE bridge: ${bridge.mode}${bridge.publishEnabled ? '' : ' (publish disabled)'}`,
  );
}
