# Free text AI for Void Space

The existing server-side text adapter supports the original Ollama endpoint and OpenRouter. A dedicated OpenRouter key was created through the owner's browser with a $0 credit limit and 90-day expiry. The key belongs only in the ignored root `.env` or the server's secret store; never add it to frontend variables, source, screenshots or logs.

```dotenv
OPENROUTER_API_KEY=<server-secret>
OPENROUTER_MODEL=nvidia/nemotron-3.5-super-vl:free
OPENROUTER_BASE_URL=https://openrouter.ai/api/v1
OPENROUTER_PREFERRED=true
OPENROUTER_FREE_ONLY=true
OPENROUTER_DISABLE_REASONING=true
```

`OPENROUTER_PREFERRED=true` tries OpenRouter before the existing Qwen endpoint. If disabled, the original fallback order is preserved. `OPENROUTER_FREE_ONLY=true
OPENROUTER_DISABLE_REASONING=true` rejects model names except `openrouter/free` and `:free` variants and adds a zero-price ceiling for prompt, completion and request charges. Provider keys remain isolated between requests; invalid content must still pass each feature's schema and source-reference validation. AI output remains a draft until review.

The configured original Qwen endpoint is retained. API and worker processes must reload after configuration changes. Free inference is quota-limited and has no availability guarantee. Do not create additional accounts or keys to bypass quota. If a free request fails, show the saved draft/conversation and manual recovery path; do not silently switch to a paid model.

Official references:
- [Free models router](https://openrouter.ai/docs/guides/routing/routers/free-router)
- [Rate limits](https://openrouter.ai/docs/api_reference/limits)
- [Provider price ceilings](https://openrouter.ai/docs/guides/routing/provider-selection#max-price)

The random free router selected a mandatory-reasoning model that exhausted the bounded output allowance without lesson content. The deployment therefore pins the tested free Nemotron model. Its public model metadata allows reasoning to be disabled; `OPENROUTER_DISABLE_REASONING=true` reserves the output budget for usable lesson JSON. Do not enable this flag for mandatory-reasoning models.

Run a small, explicit live check from the repository root:

```sh
pnpm --filter @void-space/api exec tsx ../../scripts/check-text-ai.mts
```

The check sends only a synthetic readiness request and reports provider/model, success and latency. It does not establish that long generations, every free endpoint or future quota will succeed.

## Verification on 24 November 2026

- Original Qwen readiness request timed out without returning bytes.
- Free router readiness succeeded, but a mandatory-reasoning selection exhausted the output allowance with no usable JSON. Specific free Ling and Gemma endpoints also returned upstream capacity limits; no account or quota bypass was used.
- The selected Nemotron endpoint returned a validated model/source lesson directly in about seven seconds. The real queued personal-agent workflow also created a 15-minute private-model lesson successfully. AI revision was applied with the model preserved; private study, PDF and PowerPoint downloads succeeded. BrowserOS Neo verified signup and an actual agent reply. Contextual coaching returned `mode: ai` from OpenRouter.
- Free-only preference/price-ceiling/reasoning configuration tests: 16 passing. API: 199 passing; worker: 84 passing; web unit: 30 passing; full production browser suite: 19 passing. API, worker and AI package type validation passed; production web build passed.
- The key's credit limit and reported usage were both $0 after testing. Free availability remains variable: a successful check is not an uptime guarantee or a promise that every future request will finish. Existing manual recovery remains available.

All live lesson content used synthetic notes and test models. The real provider key is excluded from git. The original provider remains configured as a fallback; no paid model or subscription was enabled.

The live label-proposal check initially failed because the worker expected JSON without requesting JSON mode. A controlled-provider regression reproduced it; the request now explicitly uses JSON mode. The corrected live queued test returned one unreviewed proposal against the supplied mesh key. Temporary test workspaces were removed after terminal task completion.
