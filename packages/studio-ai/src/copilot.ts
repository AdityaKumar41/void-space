/**
 * The Copilot's tool-use loop (VS2-SRS-1.0 §7.2, FR-11.1–11.5).
 *
 * This module is the executable form of §7.1 — **AI proposes, the command system applies** — and the
 * boundary is worth stating precisely, because it is the whole design:
 *
 *   - This loop talks to the model, validates every call it returns, and reports back what happened.
 *   - It **never mutates the scene document.** Accepted calls are handed to the caller's
 *     `applyCommands`, which runs them through the same Command objects a mouse drag would produce.
 *
 * Everything §7.1 promises therefore follows structurally rather than by discipline: an AI edit is
 * undo-able because it *is* a command; it is reviewable because the transcript lists what was
 * proposed, applied and refused; and it cannot be silently authoritative because a refusal carries a
 * plain-language reason to the chat panel (FR-11.3).
 *
 * Publishing is unreachable from here. `publish` is not in the tool catalogue and the validator
 * refuses it by name (FR-11.5), so no instruction — however phrased — can make the Copilot ship an
 * asset.
 */
import {
  newCommandGroupId,
  toClaudeTools,
  validateToolCall,
  STUDIO_TOOL_SCHEMA_VERSION,
  type AcceptedToolCall,
  type ProposedToolCall,
  type RejectedToolCall,
  type SceneSummary,
  type ValidationContext,
} from '@void-space/studio-engine';

import type { ClaudeClient, ClaudeContentBlock, ClaudeMessage } from './claude';
import { PROMPT_VERSIONS, type StudioAiFeature } from './policy';

/**
 * The system prompt.
 *
 * Written to constrain rather than to charm. Three instructions carry the weight:
 *
 *   - *Use only the provided tools* — §7.2's requirement that the model never emit instructions to run
 *     arbitrary script. The catalogue being closed is the enforcement; this is the instruction that
 *     keeps the model from spending a turn discovering that.
 *   - *One tool call per distinct change* — a model that batches unrelated edits into one call
 *     produces a call the schema rejects wholesale, losing the valid parts of the instruction.
 *   - *Do not claim work is finished* — §7.2's transparency rule. The model does not know what was
 *     applied; the panel, not the model, is the source of truth about outcomes.
 */
export const COPILOT_SYSTEM_PROMPT = `You are the VOID·STUDIO Copilot. You edit a 3D scene by calling tools.

Rules:
- Use only the provided tools. Never describe a script, a command line, or code the user should run.
- Emit one tool call per distinct change. "Add a crate and make the table metallic" is two calls.
- Rotations are in degrees. Coordinates are in metres and share the scene origin.
- Before changing an object, use its objectId from the scene summary. Never invent an id.
- Delete and group operations affect several objects; be explicit rather than assuming.
- Do not claim work is finished. The editor reports which calls were applied and which were refused,
  and it will correct you.
- You cannot publish, submit for review, or issue a licence. If asked, say that publishing needs an
  explicit action in the editor and stop.
- If the instruction is ambiguous, or refers to something not in the scene, ask a short question
  instead of guessing.`;

/** One model round trip, recorded for the Copilot transcript (§7.2 transparency, §5 CopilotMessage). */
export interface CopilotStep {
  readonly iteration: number;
  /** Assistant prose, if any. Kept so a clarifying question reaches the panel. */
  readonly assistantText: readonly string[];
  readonly proposed: readonly ProposedToolCall[];
  readonly outcomes: readonly (AcceptedToolCall | RejectedToolCall)[];
}

/** What the command layer reports back for one accepted call. */
export interface CommandApplicationResult {
  readonly callId: string | undefined;
  readonly ok: boolean;
  /** Ids of objects the command created, so a later call in the same instruction can reference them. */
  readonly createdObjectIds?: readonly string[];
  readonly error?: string;
}

/**
 * Applies accepted calls through the editor's command system.
 *
 * Supplying this is what makes a multi-step instruction work: "add a crate and make **it** metallic"
 * needs the crate's id, which only exists once the first command has run. Without it the loop is a
 * pure proposal engine and the caller applies everything afterwards.
 */
export type ApplyCommands = (
  calls: readonly AcceptedToolCall[],
) => Promise<readonly CommandApplicationResult[]>;

export interface CopilotRunInput {
  readonly tenantId: string;
  readonly userId?: string | undefined;
  readonly instruction: string;
  readonly scene: SceneSummary;
  readonly canEditProject: boolean;
  readonly enabledAiFeatures?: readonly StudioAiFeature[] | undefined;
  readonly applyCommands?: ApplyCommands | undefined;
  /** Overrides the policy's `maxCopilotIterations`, for a caller with a tighter job budget. */
  readonly maxIterations?: number | undefined;
}

export type CopilotStopReason =
  | 'end_turn'
  /** The model kept requesting tools past the iteration bound. */
  | 'max_iterations'
  /** The provider failed. The transcript so far is still returned. */
  | 'provider_error';

export interface CopilotRunResult {
  readonly steps: readonly CopilotStep[];
  readonly applied: readonly AcceptedToolCall[];
  readonly rejected: readonly RejectedToolCall[];
  readonly stopReason: CopilotStopReason;
  /** Present when `stopReason` is `provider_error`. */
  readonly error?: string | undefined;
  readonly model: string;
  readonly promptVersion: string;
  readonly toolSchemaVersion: string;
  /** Model calls made for this instruction — the number the cost controls are actually about. */
  readonly modelCalls: number;
  readonly usage: { readonly inputTokens: number; readonly outputTokens: number };
}

/**
 * Renders the scene summary the model is shown (§7.2's "compact JSON summary").
 *
 * A summary, never geometry. §7.2 is explicit about why: a full mesh in the prompt is slow, expensive
 * and no more useful — the model needs to name objects and know what is selected, not to see
 * triangles. `children` is included because the validator refuses a delete of a parent without
 * `recursive`, and a model that cannot see children would hit that refusal with no way to understand
 * it.
 */
export function buildSceneContext(scene: SceneSummary): string {
  const objects = scene.objects.map((object) => ({
    id: object.id,
    name: object.name,
    type: object.type,
    children: object.childCount,
    materials: object.materialIds.length,
  }));

  return JSON.stringify(
    { unit: scene.unit, selected: scene.selection, objectCount: objects.length, objects },
    null,
    2,
  );
}


function isTextBlock(block: ClaudeContentBlock): block is Extract<ClaudeContentBlock, { type: 'text' }> {
  return block.type === 'text';
}

function isToolUseBlock(
  block: ClaudeContentBlock,
): block is Extract<ClaudeContentBlock, { type: 'tool_use' }> {
  return block.type === 'tool_use';
}

/**
 * What the model is told about one call's fate (§7.2 transparency).
 *
 * The wording matters more than it looks. When no `applyCommands` was supplied the result says the
 * call was *queued*, not applied — because it was. Telling the model "done" before the command layer
 * has run invites it to build a follow-up on a change that the command's own `do()` may yet refuse,
 * and the Creator would read two confident sentences describing one edit.
 */
function toToolResult(
  outcome: AcceptedToolCall | RejectedToolCall,
  application: readonly CommandApplicationResult[],
  applying: boolean,
): ClaudeContentBlock {
  const toolUseId = outcome.id ?? 'call_unknown';

  if (outcome.status === 'rejected') {
    return {
      type: 'tool_result',
      tool_use_id: toolUseId,
      content: `Refused (${outcome.reason}): ${outcome.message}`,
      is_error: true,
    };
  }

  if (!applying) {
    return {
      type: 'tool_result',
      tool_use_id: toolUseId,
      content:
        'Validated and queued as an undoable command. It has not been applied to the scene yet, so do not assume its result.',
    };
  }

  const result = application.find((entry) => entry.callId === outcome.id);

  if (result === undefined) {
    // The command layer did not report on this call. Reported as an error rather than a silent
    // success, because guessing "probably fine" is how a model ends up narrating an edit nobody made.
    return {
      type: 'tool_result',
      tool_use_id: toolUseId,
      content: 'The editor did not report an outcome for this call.',
      is_error: true,
    };
  }

  if (!result.ok) {
    return {
      type: 'tool_result',
      tool_use_id: toolUseId,
      content: `The command failed: ${result.error ?? 'no reason given'}`,
      is_error: true,
    };
  }

  const created = result.createdObjectIds ?? [];
  return {
    type: 'tool_result',
    tool_use_id: toolUseId,
    content:
      created.length > 0
        ? `Applied. New object ids: ${created.join(', ')}.`
        : 'Applied as an undoable command.',
  };
}


/**
 * Runs one Copilot instruction to completion.
 *
 * Bounded by `maxIterations`, and the bound is not defensive padding: §7.5 makes cost control a
 * requirement, and a model that keeps requesting tools without finishing would otherwise bill
 * indefinitely against a single sentence. Hitting the bound reports `max_iterations` rather than
 * success, so the panel can say the instruction was only partly carried out.
 */
export async function runCopilot(
  client: ClaudeClient,
  input: CopilotRunInput,
): Promise<CopilotRunResult> {
  const maxIterations = input.maxIterations ?? client.copilotIterationLimit;

  // One group id for the whole instruction, shared by every iteration's accepted calls, so the
  // Creator's single "undo" reverses one sentence rather than one round trip (§7.2).
  const groupId = newCommandGroupId();

  const context: ValidationContext = {
    scene: input.scene,
    canEditProject: input.canEditProject,
    ...(input.enabledAiFeatures === undefined ? {} : { enabledAiFeatures: input.enabledAiFeatures }),
  };

  const messages: ClaudeMessage[] = [
    {
      role: 'user',
      content: [
        {
          type: 'text',
          text: `Current scene:\n${buildSceneContext(input.scene)}\n\nInstruction: ${input.instruction}`,
        },
      ],
    },
  ];

  const steps: CopilotStep[] = [];
  const applied: AcceptedToolCall[] = [];
  const rejected: RejectedToolCall[] = [];
  let usage = { inputTokens: 0, outputTokens: 0 };
  let modelCalls = 0;
  let modelId = '';
  let stopReason: CopilotStopReason = 'max_iterations';
  let error: string | undefined;

  for (let iteration = 0; iteration < maxIterations; iteration += 1) {
    let content: readonly ClaudeContentBlock[];

    try {
      const response = await client.createMessage({
        tenantId: input.tenantId,
        userId: input.userId,
        feature: 'copilot',
        promptVersion: PROMPT_VERSIONS.copilotSystem,
        system: COPILOT_SYSTEM_PROMPT,
        messages,
        tools: toClaudeTools(),
        maxTokens: 4096,
      });

      modelCalls += 1;
      modelId = response.model;
      usage = {
        inputTokens: usage.inputTokens + response.usage.inputTokens,
        outputTokens: usage.outputTokens + response.usage.outputTokens,
      };

      content = response.content;

      // `stop_reason` is the loop's real control. Trusting the presence of tool_use blocks instead
      // would keep looping on a truncated response (`max_tokens`), whose tool calls are incomplete.
      if (response.stopReason !== 'tool_use') {
        steps.push({
          iteration,
          assistantText: content.filter(isTextBlock).map((block) => block.text),
          proposed: [],
          outcomes: [],
        });
        stopReason = 'end_turn';
        break;
      }
    } catch (err) {
      // The transcript so far is kept rather than discarded: a Creator whose third edit failed needs
      // to be able to see that the first two landed.
      error = (err as Error).message;
      stopReason = 'provider_error';
      break;
    }

    const assistantText = content.filter(isTextBlock).map((block) => block.text);
    const proposed: ProposedToolCall[] = content.filter(isToolUseBlock).map((block) => ({
      id: block.id,
      name: block.name,
      input: block.input,
    }));

    if (proposed.length === 0) {
      steps.push({ iteration, assistantText, proposed: [], outcomes: [] });
      stopReason = 'end_turn';
      break;
    }

    const outcomes = proposed.map((call) => validateToolCall(call, context, groupId));
    const accepted = outcomes.filter(
      (outcome): outcome is AcceptedToolCall => outcome.status === 'accepted',
    );
    const refused = outcomes.filter(
      (outcome): outcome is RejectedToolCall => outcome.status === 'rejected',
    );

    applied.push(...accepted);
    rejected.push(...refused);

    let application: readonly CommandApplicationResult[] = [];
    if (input.applyCommands && accepted.length > 0) {
      try {
        application = await input.applyCommands(accepted);
      } catch (err) {
        // One command throwing must not lose the others' outcomes. Every accepted call is reported as
        // failed with the same reason, so the model's next turn knows that nothing landed.
        application = accepted.map((call) => ({
          callId: call.id,
          ok: false,
          error: (err as Error).message,
        }));
      }
    }

    steps.push({ iteration, assistantText, proposed, outcomes });

    messages.push({ role: 'assistant', content });
    messages.push({
      role: 'user',
      content: outcomes.map((outcome) =>
        toToolResult(outcome, application, input.applyCommands !== undefined),
      ),
    });
  }

  return {
    steps,
    applied,
    rejected,
    stopReason,
    ...(error === undefined ? {} : { error }),
    model: modelId,
    promptVersion: PROMPT_VERSIONS.copilotSystem,
    toolSchemaVersion: STUDIO_TOOL_SCHEMA_VERSION,
    modelCalls,
    usage,
  };
}

