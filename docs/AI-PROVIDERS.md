# Shared text AI providers

Void Space uses `@void-space/ai/text` for server-side text generation in lesson authoring, quizzes, annotation planning, coaching and asset metadata enrichment. Credentials stay on the server.

## Configuration

The root ignored `.env` supplies `AI_TEXT_BASE_URL`, `AI_TEXT_MODEL`, an optional `AI_TEXT_FALLBACK_MODEL`, `AI_TEXT_PROTOCOL` and `AI_TEXT_TIMEOUT_MS`. Native `/api/generate` endpoints use the Ollama protocol; compatible chat endpoints use the OpenAI message format. The configured response records the actual answering provider and model.

An explicitly configured OpenRouter fallback requires `OPENROUTER_API_KEY` and `OPENROUTER_MODEL`. With `OPENROUTER_FREE_ONLY=true`, only free model routes are accepted. Direct OpenRouter-compatible endpoints receive the same free-routing and reasoning controls. No paid fallback is introduced automatically.

## Failure handling

Structured requests validate the output schema, references and answer keys. Eligible requests have one bounded repair attempt within their deadline. Invalid content is not silently accepted. Provider timeouts, unavailable services and malformed output return safe recovery information. Ordinary editing and study remain available.

Restart API and background worker processes after changing server configuration. For local durable agent execution, `LEARNING_AGENT_ENGINE=inngest` requires the Inngest development server; `pnpm dev` starts it when configured.

Image generation is controlled separately by `AI_IMAGE_ENABLED`. It remains paused in the current local configuration. Manual source uploads remain available.

## Verification

- `pnpm --filter @void-space/ai test`: provider routing, schema repair, deadlines and failure behavior.
- `pnpm ai:check`: synthetic live text-provider probe.
- `pnpm ai:check:learning`: live seeded lesson/mentor check with cleanup.

Live provider checks send synthetic material to the configured service. Automated unit and API suites use provider fixtures for repeatable results.
