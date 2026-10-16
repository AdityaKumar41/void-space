/**
 * VOID·STUDIO Worker Entry Point.
 *
 * Loads environment before ESM imports are hoisted.
 */
import { loadRootEnv } from '@void-space/studio-db/env';

loadRootEnv({ override: true });

const { main } = await import('./main');

await main();
