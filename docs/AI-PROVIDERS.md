# Shared text AI providers

The API lesson mentor and lesson authoring, metadata enrichment worker, and Studio
Copilot/readiness narrative share the compatible provider adapter in
`packages/studio-ai/src/text.ts`. Existing Anthropic support remains available in
the metadata worker and Studio when no compatible provider is selected.

The user authorized the CUTM host and optional OpenRouter fallback on 29 October 2026. The previous Anthropic-specific approval block does not apply to this newly
authorized configuration. No Anthropic mentor transmission was enabled.

## Current local configuration

The repository-root `.env` uses:

```dotenv
AI_BASE_URL=https://qwen.cutm.ac.in
AI_TEXT_BASE_URL=https://qwen.cutm.ac.in/api/generate
AI_TEXT_MODEL=qwen2.5-coder:32b
AI_TEXT_FALLBACK_MODEL=mistral:7b
AI_TEXT_PROTOCOL=auto
AI_TEXT_TIMEOUT_MS=30000
```

Live observations on 29 October 2026:

- The host advertises `qwen2.5-coder:32b`, but native generation returns an HTTP
  200 error envelope saying that model is unavailable. The compatible chat API
  returns an empty completion for it. Both are correctly treated as failures.
- `mistral:7b` on the same host returned actual text, generated a valid lesson body
  and three-question assessment, answered the lesson mentor's component question,
  and returned a structured function call in the Studio compatibility probe.
- Configured does not mean healthy. `GET /api/v1/ai/status` is authenticated and
  reports configuration with `availability: "not_probed"`. Diagnostic commands
  below perform actual generation checks.

The requested Qwen model remains first in the chain. Once the server provides it,
it can answer without changing the app. Until then, the explicitly configured
same-host Mistral model is tried next. Returned answers, audit metadata and
stored enrichment outcomes record the answering model rather than pretending
that Qwen produced them.

## Optional OpenRouter fallback

Set both server-side values to enable the final fallback:

```dotenv
OPENROUTER_API_KEY=your-server-side-key
OPENROUTER_MODEL=provider/model-you-have-selected
OPENROUTER_BASE_URL=https://openrouter.ai/api/v1
```

No OpenRouter key or model was supplied in this session, so the fallback is wired
and tested using injected transport responses, but is not enabled or live-verified.
Keys are not sent to browsers or other providers. An optional `AI_TEXT_API_KEY`
applies only to the primary host. Native development loads the root `.env` at
process startup; restart running API/worker/Studio services after changing it.
Compose passes these settings to all relevant services as well.

## Protocol and failure behavior

- A full `/api/generate` URL uses native Ollama-style non-streaming generation.
  Limits are supplied in `options.num_predict` and as `max_tokens` for gateways.
- A host URL, `/v1` base or full `/v1/chat/completions` URL uses compatible chat.
  `AI_TEXT_PROTOCOL` can explicitly select `ollama` or `openai`.
- Studio converts its existing Messages/tool-result history and tool schemas to
  compatible chat on the configured host. For native text endpoint configuration,
  Studio uses the same origin's `/v1/chat/completions` for structured tool calls.
  The existing scene-command validators, tenant feature flags, rate limiter,
  redaction, timeout and invocation logging remain in place. A model cannot
  bypass the separate human publish action.
- Error envelopes in HTTP 200 responses, blank answers, truncated output, malformed
  tool arguments, and invalid consumer JSON trigger the next configured provider.
  Failover shares one overall deadline. Requests refuse redirects.
- Metadata suggestions must pass the existing enrichment schema. Exhausted model
  failures follow the worker's existing retry/manual-review path; they do not
  create fabricated successful AI suggestions.
- Lesson generation is explicitly selected by the author. Paste a source procedure
  or notes, select an approved asset, and check **Generate a draft with the
  configured AI provider**. The model generates bounded lesson-body and quiz
  responses separately to accommodate the host's small output ceiling. The server
  controls the pass threshold. Content remains an unpublished editable draft.
  Provider/model and a hash indicating the supplied source are written to the
  creation audit event. Provider calls run outside the DB transaction; approval
  and asset version are rechecked before the draft is saved.
- If generation fails, a template is labelled as a template in the editor. It is
  never represented as a generated, verified procedure. The mentor similarly
  falls back to labelled local transcript references.
- File-based PDF/DOCX/SOP extraction and asynchronous bulk curriculum generation
  are still separate remaining work. This implementation accepts pasted source
  text; it does not claim to ingest document files.

## Verification

```bash
pnpm ai:check
pnpm ai:check:learning
```

The first command sends only a generic `Reply with only OK` probe and reports the
actual answering provider/model. The second uses public drill-component notes,
the local seeded demo account and the real API authorization, draft, publication,
and mentor routes. It removes only its identified temporary lesson. It requires
the seeded local database/Redis stack and live provider access.

Deterministic tests cover routing, empty/error envelopes, bounded schema checks,
credential separation, same-host model fallback, OpenRouter fallback, Studio tool
history conversion and invocation logging, generated lesson validation, mentor
fallback and worker enrichment validation. Live checks are not required by the
normal unit/integration suite.

Protocol references: [native generation](https://docs.ollama.com/api/generate),
[compatible chat](https://docs.ollama.com/api/openai-compatibility),
[OpenRouter chat](https://openrouter.ai/docs/api/api-reference/chat/create-a-chat-completion).

Verified in this implementation pass: 123 API tests, 60 worker tests, 45 shared
AI tests, 61 Studio API tests (10 existing integration cases skipped), 34 shared
contract tests, all 22 workspace typecheck tasks, the Chrome lesson/room workflow,
and both Compose configuration validations. Live provider, generated lesson plus
mentor, metadata enrichment, and structured tool-call probes also succeeded
through `mistral:7b`. Lint and whitespace checks passed for the changed sources.
