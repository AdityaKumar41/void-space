/**
 * Live end-to-end check of the AI learning-insights route.
 *
 * Logs in as the seeded local demo creator, calls POST /learning/analytics/insights
 * against the real provider configured in the root .env, and verifies the response
 * shape. It sends only the aggregate analytics payload the route itself builds — the
 * same data any generated insight is allowed to see. Requires the seeded local
 * database/Redis stack and a configured text AI provider.
 */
import { loadRootEnv } from '../packages/db/src/env';
loadRootEnv();
const { loadEnv } = await import('../apps/api/src/env');
const { buildApp } = await import('../apps/api/src/app');
const env = loadEnv({ ...process.env, NODE_ENV: 'test', LOG_LEVEL: 'error' });
const app = await buildApp(env);
try {
  const login = await app.inject({
    method: 'POST',
    url: '/api/v1/auth/login',
    payload: { email: 'creator@aurora.dev', password: 'VoidSpace!2026' },
  });
  if (login.statusCode !== 200) throw new Error('Local demo login failed');
  const rawCookie = login.headers['set-cookie'];
  const cookie = (Array.isArray(rawCookie) ? rawCookie : [rawCookie ?? ''])
    .map((value) => value.split(';')[0])
    .join('; ');
  const response = await app.inject({
    method: 'POST',
    url: '/api/v1/learning/analytics/insights',
    headers: { cookie },
  });
  if (response.statusCode === 503) {
    const body = response.json() as { code?: string };
    if (body.code === 'AI_NOT_CONFIGURED')
      throw new Error(
        'Insights are not configured. Set GEMINI_API_KEY (free tier) or OPENAI_API_KEY (or an AI_TEXT_* provider) in the root .env file and restart the API.',
      );
    if (body.code === 'AI_PROVIDER_QUOTA_EXCEEDED')
      throw new Error(
        'The AI provider reports insufficient quota (HTTP 429) for the configured key. For the Gemini free tier, limits reset per minute/per day — wait and retry or check usage in Google AI Studio; for OpenAI, top up at https://platform.openai.com/settings/organization/billing/.',
      );
    if (body.code === 'AI_PROVIDER_RATE_LIMITED')
      throw new Error(
        'Rate or free-tier usage limit reached for the configured key (HTTP 429). Wait a moment and retry, or raise the account usage limit.',
      );
    if (body.code === 'AI_PROVIDER_AUTH_FAILED')
      throw new Error(
        'The AI provider rejected the configured API key (HTTP 401/403). Verify GEMINI_API_KEY (or OPENAI_API_KEY) in the root .env file and restart the API.',
      );
    throw new Error(
      `Insights unavailable (503 ${body.code ?? 'UNKNOWN'}). Check the AI provider usage and configuration, then retry.`,
    );
  }
  if (response.statusCode !== 200)
    throw new Error(`Insights route returned HTTP ${response.statusCode}`);
  const body = response.json() as { insights: unknown; recommendations: unknown };
  const items = [body.insights, body.recommendations];
  for (const list of items) {
    if (!Array.isArray(list) || list.length < 1 || list.length > 3)
      throw new Error('Expected 1-3 items in insights and recommendations');
    for (const item of list)
      if (typeof item !== 'string' || item.trim().length < 20)
        throw new Error('Insight items must be non-trivial strings');
  }
  console.log(
    JSON.stringify(
      { ok: true, insights: body.insights, recommendations: body.recommendations },
      null,
      2,
    ),
  );
} catch (error) {
  console.error(error instanceof Error ? error.message : 'Learning insights check failed');
  process.exitCode = 1;
} finally {
  await app.close();
  const { disconnectAll } = await import('../packages/db/src/client');
  await disconnectAll();
}
