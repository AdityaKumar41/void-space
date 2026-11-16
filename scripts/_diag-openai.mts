/**
 * Temporary diagnostic: verify the configured OpenAI key against the live API.
 * Never prints the key; prints only HTTP statuses and provider error messages.
 */
import { loadRootEnv } from '../packages/db/src/env';
loadRootEnv();

const key = process.env.OPENAI_API_KEY?.trim();
const model = process.env.OPENAI_MODEL?.trim() || 'gpt-4o-mini';
const base = process.env.OPENAI_BASE_URL?.trim() || 'https://api.openai.com/v1';

if (!key) {
  console.log('OPENAI_API_KEY is empty after parsing');
  process.exit(1);
}
console.log(`key length=${key.length} prefix=${key.slice(0, 7)}... model=${model} base=${base}`);

const headers = { authorization: `Bearer ${key}`, 'content-type': 'application/json' };

const models = await fetch(`${base.replace(/\/+$/, '')}/models`, { headers });
console.log(`GET /models -> HTTP ${models.status}`);
if (!models.ok) {
  const body = await models.text();
  try {
    const parsed = JSON.parse(body);
    console.log('error:', parsed?.error?.message ?? body.slice(0, 300));
    console.log('code:', parsed?.error?.code, 'type:', parsed?.error?.type);
  } catch {
    console.log('body:', body.slice(0, 300));
  }
} else {
  const body = (await models.json()) as { data?: { id: string }[] };
  const ids = (body.data ?? []).map((m) => m.id);
  console.log(`models visible: ${ids.length}; gpt-4o-mini present: ${ids.includes('gpt-4o-mini')}`);
  console.log(`configured model "${model}" available: ${ids.includes(model)}`);
}

const chat = await fetch(`${base.replace(/\/+$/, '')}/chat/completions`, {
  method: 'POST',
  headers,
  body: JSON.stringify({
    model,
    messages: [{ role: 'user', content: 'Reply with the single word: ok' }],
    max_tokens: 5,
    temperature: 0,
  }),
});
console.log(`POST /chat/completions -> HTTP ${chat.status}`);
const chatBody = await chat.text();
try {
  const parsed = JSON.parse(chatBody);
  if (parsed.error) {
    console.log('error:', parsed.error.message);
    console.log('code:', parsed.error.code, 'type:', parsed.error.type, 'param:', parsed.error.param);
  } else {
    console.log('completion ok:', JSON.stringify(parsed.choices?.[0]?.message?.content ?? ''));
    console.log('usage:', JSON.stringify(parsed.usage));
  }
} catch {
  console.log('body:', chatBody.slice(0, 300));
}
