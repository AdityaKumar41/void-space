# Multilingual support

VOID·SPACE currently supports English (`en`), Telugu (`te`), and Hindi (`hi`).
The signed-in user's preference is stored on the account and follows that user
between workspaces. It can be changed in Settings or from the profile menu.

## UI languages

English is the source locale. Telugu and Hindi strings live in the web
translation catalog in `apps/web/src/lib/language.tsx`. Keep interpolation
tokens such as `{count}` intact when adding translations. The supported-language
metadata and validation codes are declared in `packages/types/src/dto/auth.ts`;
adding a language requires adding its code and metadata there, its UI catalog,
and translation tests.

## AI content translation

Lessons (including quiz prompts and answer choices) and uploaded documents can
be translated on demand into the user's selected language. Translated content
is a temporary view: it does not edit a lesson, change quiz answer keys, or
replace a document. The API checks the user's tenant membership, rate-limits
translation requests, and does not log document or lesson text.

Uploaded PDF, DOCX, TXT, Markdown, and RTF documents are supported. Legacy DOC
files must be saved as DOCX or PDF first. Translation is limited to 20,000
extracted characters per document and PDFs of at most 100 pages. The original
upload is still protected by the document route and is not modified.

AI translation uses the configured text provider. Configure either
`AI_TEXT_BASE_URL` and `AI_TEXT_MODEL` (optionally with `AI_TEXT_API_KEY`), or
both `OPENROUTER_API_KEY` and `OPENROUTER_MODEL`. With no provider configured,
translation returns `AI_TRANSLATION_UNAVAILABLE`; it never substitutes an
unlabeled machine-generated or source-language fallback.

Document text is sent to the configured AI provider only after a user requests
translation. Review the provider's data-handling terms before translating
sensitive workspace material.
