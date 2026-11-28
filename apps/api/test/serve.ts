/** Isolated browser-test API; honors explicit ports and test-mode rate limits. */
import { loadRootEnv } from '@void-space/db/env';
loadRootEnv({ override: false });
const { main } = await import('../src/main');
await main();
