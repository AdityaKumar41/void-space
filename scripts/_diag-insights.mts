/**
 * Temporary diagnostic: reproduce the insights call through the real text adapter.
 * Prints provider failure reasons (adapter sanitizes these; no prompts/keys).
 */
import { loadRootEnv } from '../packages/db/src/env';
loadRootEnv();
const { generateText, TextAiError, textProviders } = await import('../packages/studio-ai/src/text');

const config = {
  GEMINI_API_KEY: process.env.GEMINI_API_KEY,
  GEMINI_MODEL: process.env.GEMINI_MODEL,
  GEMINI_BASE_URL: process.env.GEMINI_BASE_URL,
  OPENAI_API_KEY: process.env.OPENAI_API_KEY,
  OPENAI_MODEL: process.env.OPENAI_MODEL,
  OPENAI_BASE_URL: process.env.OPENAI_BASE_URL,
  AI_TEXT_TIMEOUT_MS: process.env.AI_TEXT_TIMEOUT_MS
    ? Number(process.env.AI_TEXT_TIMEOUT_MS)
    : undefined,
};
console.log('providers:', textProviders(config).map((p) => ({ name: p.name, model: p.model, url: p.url })));

try {
  const result = await generateText(config, {
    json: true,
    maxTokens: 700,
    temperature: 0.2,
    messages: [
      { role: 'system', content: 'You are a learning analytics assistant. Return JSON with an insights array and a recommendations array, each containing 1 to 3 items.' },
      { role: 'user', content: 'summary: {"learnerCount": 2, "averageScore": 71.5, "passRate": 55, "attemptCount": 8}. Return the JSON now.' },
    ],
  });
  console.log('OK provider=%s model=%s', result.provider, result.model);
  console.log('text:', result.text.slice(0, 400));
} catch (error) {
  if (error instanceof TextAiError) {
    console.log('TextAiError failures:', JSON.stringify(error.failures, null, 2));
  } else {
    console.log('unexpected error:', error);
  }
}
