/**
 * The tool catalogue rendered into the shape the Claude Messages API expects (VS2-SRS-1.0 §7.2).
 *
 * This exists as its own module, and takes a dependency on a Zod-to-JSON-Schema converter, for one
 * reason: **the schema the model is shown must be derived from the schema we validate against.**
 *
 * §7.2 says the model is given "a fixed, versioned schema of editor functions". If that description
 * were hand-written alongside the Zod objects in `tools.ts`, the two would be free to disagree — and
 * they disagree silently and asymmetrically:
 *
 *   - A parameter the model is told about but the validator rejects produces a call the Copilot
 *     proposes and then refuses, which reads to a Creator as the assistant being broken.
 *   - A parameter the validator accepts but the model was never told about is worse: it is
 *     unreachable, so a capability the SRS requires simply never fires and nothing reports it.
 *
 * Deriving both from one source makes those states unrepresentable rather than merely unlikely.
 */
import { zodToJsonSchema } from 'zod-to-json-schema';

import { STUDIO_TOOLS, listStudioTools, type StudioToolDefinition } from './tools';

/**
 * One tool in Anthropic's `tools[]` shape.
 *
 * `input_schema` is JSON Schema; `additionalProperties: false` is set below because the tool input we
 * validate is a closed object. Leaving it open would let the model invent extra keys that Zod then
 * strips, so a call could look applied while part of what the model asked for was quietly dropped.
 */
export interface ClaudeToolDefinition {
  readonly name: string;
  readonly description: string;
  readonly input_schema: Record<string, unknown>;
}

/**
 * Converts one tool.
 *
 * `$refStrategy: 'none'` inlines nested types instead of emitting `$ref`s. Anthropic's API accepts
 * JSON Schema but does not resolve external or internal references, and a schema containing `$ref`
 * is a schema the model cannot read — it would see a parameter it has no definition for.
 */
export function toClaudeTool(definition: StudioToolDefinition): ClaudeToolDefinition {
  const generated = zodToJsonSchema(definition.schema, {
    $refStrategy: 'none',
    target: 'jsonSchema7',
  }) as Record<string, unknown>;

  // `zodToJsonSchema` wraps an object schema in `{ $schema, type, properties, ... }`; the API wants
  // that body directly as `input_schema`, so the metaschema key is dropped rather than forwarded.
  const { $schema: _ignored, ...input_schema } = generated;

  return {
    name: definition.name,
    description: definition.description,
    input_schema: { ...input_schema, additionalProperties: false },
  };
}

/**
 * The whole catalogue, in declaration order.
 *
 * §7.2 calls the set "fixed, versioned"; the version travels with the caller as
 * `STUDIO_TOOL_SCHEMA_VERSION` and is what a stored `CopilotMessage` records.
 */
export function toClaudeTools(): readonly ClaudeToolDefinition[] {
  return listStudioTools().map(toClaudeTool);
}

/** Lookup by name, for a caller that already knows which tool a stored call referenced. */
export function toClaudeToolByName(name: keyof typeof STUDIO_TOOLS): ClaudeToolDefinition {
  return toClaudeTool(STUDIO_TOOLS[name]);
}
