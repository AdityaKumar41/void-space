/** Synthetic image readiness check; no learner material or credentials are logged. */
import { createRequire } from 'node:module';
import { loadRootEnv } from '../packages/db/src/env';
import { generateText, TextAiError } from '../packages/ai/src/text';
loadRootEnv({ override: false });
const sharp = createRequire(new URL('../apps/worker/package.json', import.meta.url))('sharp');
const bytes = await sharp({
  create: { width: 64, height: 64, channels: 3, background: { r: 220, g: 30, b: 30 } },
})
  .png()
  .toBuffer();
const start = Date.now();
try {
  const output = await generateText(
    {
      AI_TEXT_BASE_URL: process.env.AI_VISION_BASE_URL,
      AI_TEXT_MODEL: process.env.AI_VISION_MODEL,
      AI_TEXT_API_KEY: process.env.AI_VISION_API_KEY,
      AI_TEXT_PROTOCOL: 'openai',
      AI_TEXT_TIMEOUT_MS: 25000,
    },
    {
      messages: [
        {
          role: 'user',
          content:
            'Describe the dominant color of this synthetic image. Return only JSON {"color":"red"}.',
        },
      ],
      images: [`data:image/png;base64,${bytes.toString('base64')}`],
      maxTokens: 500,
      json: true,
      validate: (text) => {
        if (JSON.parse(text).color !== 'red') throw new Error('Wrong color');
      },
    },
  );
  console.log(
    JSON.stringify({
      ok: true,
      provider: output.provider,
      model: output.model,
      elapsedMs: Date.now() - start,
    }),
  );
} catch (error) {
  console.log(
    JSON.stringify({
      ok: false,
      failures: error instanceof TextAiError ? error.failures : [],
      elapsedMs: Date.now() - start,
    }),
  );
  process.exitCode = 1;
}
