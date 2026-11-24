/** Verify configured text providers with a public, non-sensitive prompt. */
import { loadRootEnv } from '../packages/db/src/env';
import {
  generateText,
  TextAiError,
  textAiEnvSchema,
  textProviders,
} from '../packages/studio-ai/src/text';

loadRootEnv({ override: false });
const config = textAiEnvSchema.parse(process.env);
if (!textProviders(config).length) {
  console.error('No text AI provider is configured. Set AI_TEXT_BASE_URL and AI_TEXT_MODEL.');
  process.exitCode = 1;
} else {
  const started = Date.now();
  try {
    const result = await generateText(config, {
      messages: [{ role: 'user', content: 'Return only a JSON object: {"ready":true}.' }],
      maxTokens: 100,
      json: true,
      validate: (text) => {
        if (JSON.parse(text).ready !== true) throw new Error('Invalid readiness result');
      },
    });
    console.log(
      JSON.stringify({
        ok: true,
        provider: result.provider,
        model: result.model,
        elapsedMs: Date.now() - started,
        freeOnly: config.OPENROUTER_FREE_ONLY,
      }),
    );
  } catch (error) {
    console.error(
      JSON.stringify({
        ok: false,
        failures: error instanceof TextAiError ? error.failures : [],
        elapsedMs: Date.now() - started,
      }),
    );
    process.exitCode = 1;
  }
}
