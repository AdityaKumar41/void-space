/**
 * Tool-call validation (VS2-SRS-1.0 FR-11.3, §7.2).
 *
 * Every tool call the Copilot proposes is checked here before anything is applied, and the three
 * checks are the three §7.2 names:
 *
 *   1. **Schema** — the call is parsed against the tool's Zod schema, so a missing or mistyped
 *      parameter is caught rather than coerced into a plausible-looking edit.
 *   2. **Permission** — the caller must actually be allowed to change this project. Enforced here
 *      rather than only in the API because the Copilot runs as a background job (§7.5), and a job
 *      that outlives a role change must not keep editing on the old authority.
 *   3. **Scene bounds** — an edit that references a node which is not in the scene is rejected, as
 *      is one the scene's own limits forbid (deleting a parent without saying so, FR-3.1).
 *
 * The outcome is always either an accepted call or a **rejected call with a reason**, never a
 * silently skipped one. That is FR-11.3's explicit requirement and §7.2's "Transparency" bullet: the
 * chat panel shows which calls were proposed, which were applied and which were refused, with a
 * plain-language reason. A validator that dropped bad calls would make the Copilot look like it
 * ignored the instruction.
 */
import type { StudioAiFeature, StudioToolName } from './tools';
import { STUDIO_TOOLS, isStudioToolName } from './tools';

/** Why a proposed call was refused. Stable codes — the UI branches on these, never on the message. */
export const REJECTION_REASONS = [
  /** The model produced a function name that is not in the catalogue. */
  'UNKNOWN_TOOL',
  /** The name is known but the arguments do not satisfy the schema. */
  'INVALID_ARGUMENTS',
  /** A referenced object id is not in the scene the model was given. */
  'OBJECT_NOT_FOUND',
  /** Deleting or regrouping a node with children, without acknowledging them. */
  'OBJECT_HAS_CHILDREN',
  /** The caller may not edit this project. */
  'PERMISSION_DENIED',
  /** A TenantAdmin has switched the tool's AI feature off (FR-18.1). */
  'FEATURE_DISABLED',
  /**
   * The model tried to publish.
   *
   * FR-11.5 forbids this outright: publishing always requires an explicit human action, mirroring
   * VS-SRS-2.0 FR-7.6. Given its own reason rather than folded into `UNKNOWN_TOOL` so the audit trail
   * records *what the model tried to do*, which is exactly the kind of thing a reviewer needs to see.
   */
  'PUBLISH_REQUIRES_HUMAN_ACTION',
] as const;
export type RejectionReason = (typeof REJECTION_REASONS)[number];

/**
 * Names that must never reach the command layer, whatever a model calls them.
 *
 * Checked before the catalogue lookup so the refusal is specific. Kept as a denylist *as well as* the
 * catalogue being closed, because "publish is absent from the tool set" and "publish is actively
 * refused" fail differently: the first is a property of today's list, the second of the product rule.
 */
const HUMAN_ONLY_TOOL_NAMES: readonly string[] = [
  'publish',
  'publishProject',
  'submit',
  'submitForReview',
  'publishAsset',
];

/** One object, as the Copilot is allowed to see it (§7.2 — a summary, never full geometry). */
export interface SceneSummaryObject {
  readonly id: string;
  readonly name: string;
  readonly type: 'mesh' | 'light' | 'camera' | 'empty' | 'armature';
  readonly childCount: number;
  readonly materialIds: readonly string[];
}

/**
 * The compact context handed to the model, and the same object the validator checks against.
 *
 * Deliberately shape-identical for both uses: validating against a *different* view of the scene than
 * the model was shown would allow a call that is valid on paper and wrong in the editor.
 */
export interface SceneSummary {
  readonly objects: readonly SceneSummaryObject[];
  /** Object ids currently selected — the target of "make it metallic". */
  readonly selection: readonly string[];
  readonly unit: 'metre' | 'centimetre';
}

export interface ValidationContext {
  readonly scene: SceneSummary;
  /** Derived from the federated JWT's roles on every request, never cached (§3.5.1, FR-1.3). */
  readonly canEditProject: boolean;
  /** FR-18.1 — the tenant's enabled AI features. An absent list means "all enabled". */
  readonly enabledAiFeatures?: readonly StudioAiFeature[];
}

/** A tool call exactly as the model returned it, before any trust is placed in it. */
export interface ProposedToolCall {
  /** The provider's call id, echoed back so the UI can pair proposal with outcome. */
  readonly id?: string;
  readonly name: string;
  readonly input: unknown;
}

export interface AcceptedToolCall {
  readonly status: 'accepted';
  readonly id: string | undefined;
  readonly name: StudioToolName;
  readonly input: unknown;
  /**
   * Shared by every call produced by one instruction.
   *
   * §7.2 requires all commands arising from a single instruction to collapse into **one undo step**,
   * so "add a crate and make it metallic" undoes as one action rather than two. The command layer
   * groups on this value; the validator is what mints it because only it sees the whole batch.
   */
  readonly groupId: string;
}

export interface RejectedToolCall {
  readonly status: 'rejected';
  readonly id: string | undefined;
  readonly name: string;
  readonly reason: RejectionReason;
  /** Plain language, shown to the Creator. Never a stack trace or a Zod dump. */
  readonly message: string;
}

export type ValidationOutcome = AcceptedToolCall | RejectedToolCall;

/** A stable-enough group id. Only needs to be unique within one instruction's batch. */
function newGroupId(): string {
  const bytes = new Uint8Array(8);
  if (typeof globalThis.crypto?.getRandomValues === 'function') {
    globalThis.crypto.getRandomValues(bytes);
  } else {
    for (let index = 0; index < bytes.length; index += 1) {
      bytes[index] = Math.floor(Math.random() * 256);
    }
  }
  let hex = '';
  for (const byte of bytes) hex += byte.toString(16).padStart(2, '0');
  return `cg-${hex}`;
}

/**
 * Mints the group id that ties one instruction's commands into a single undo step (§7.2).
 *
 * Exported because the Copilot's tool-use loop spans several model calls, and every command from the
 * whole instruction must share one group — "add a crate and make it metallic" has to undo as one
 * action even though the model emitted it across two round trips. A caller that let each iteration
 * mint its own id would produce a separate undo step per round trip for one sentence.
 */
export function newCommandGroupId(): string {
  return newGroupId();
}

/** Turns a Zod issue list into one sentence a Creator can act on. */
function explainIssues(issues: readonly { path: (string | number)[]; message: string }[]): string {
  const parts = issues.slice(0, 3).map((issue) => {
    const field = issue.path.join('.');
    return field ? `${field}: ${issue.message}` : issue.message;
  });
  const more = issues.length > 3 ? ` (and ${issues.length - 3} more)` : '';
  return `The tool call's arguments were not valid — ${parts.join('; ')}${more}`;
}

function reject(call: ProposedToolCall, reason: RejectionReason, message: string): RejectedToolCall {
  return { status: 'rejected', id: call.id, name: call.name, reason, message };
}

/**
 * Validates one proposed call.
 *
 * Order is deliberate: the human-only check runs before the catalogue lookup so a publish attempt is
 * refused for the right reason, and the permission check runs after schema parsing so a caller is not
 * told they lack permission for a call that was malformed anyway.
 */
export function validateToolCall(
  call: ProposedToolCall,
  context: ValidationContext,
  groupId: string,
): ValidationOutcome {
  if (HUMAN_ONLY_TOOL_NAMES.includes(call.name)) {
    return reject(
      call,
      'PUBLISH_REQUIRES_HUMAN_ACTION',
      `"${call.name}" is not something the Copilot can do. Publishing always needs an explicit action from you (FR-11.5).`,
    );
  }

  if (!isStudioToolName(call.name)) {
    return reject(
      call,
      'UNKNOWN_TOOL',
      `"${call.name}" is not one of the editor functions the Copilot can call, so it was not run.`,
    );
  }

  const definition = STUDIO_TOOLS[call.name];

  const parsed = definition.schema.safeParse(call.input);
  if (!parsed.success) {
    return reject(call, 'INVALID_ARGUMENTS', explainIssues(parsed.error.issues));
  }

  if (!context.canEditProject) {
    return reject(call, 'PERMISSION_DENIED', 'You do not have permission to change this project.');
  }

  // FR-18.1: a disabled feature must be refused here as well as hidden in the UI. Hiding the button
  // only stops a person from clicking it; the model is still free to propose the call.
  if (definition.aiFeature && context.enabledAiFeatures) {
    if (!context.enabledAiFeatures.includes(definition.aiFeature)) {
      return reject(
        call,
        'FEATURE_DISABLED',
        'This AI feature is disabled for your workspace, so the call was not run.',
      );
    }
  }

  const sceneIssue = checkAgainstScene(call.name, parsed.data, context.scene);
  if (sceneIssue) return reject(call, sceneIssue.reason, sceneIssue.message);

  return { status: 'accepted', id: call.id, name: call.name, input: parsed.data, groupId };
}


/**
 * The scene-bounds checks from §7.2.
 *
 * Only rules the scene summary can actually decide live here. Purely numeric bounds (a coordinate
 * limit) are already expressed in the Zod schemas, so they reject with `INVALID_ARGUMENTS` and one
 * consistent message rather than being duplicated across two layers that could drift apart.
 */
function checkAgainstScene(
  name: StudioToolName,
  input: unknown,
  scene: SceneSummary,
): { readonly reason: RejectionReason; readonly message: string } | null {
  const byId = new Map(scene.objects.map((object) => [object.id, object]));
  const missing = (id: string) => ({
    reason: 'OBJECT_NOT_FOUND' as const,
    message: `There is no object called "${id}" in this scene, so the change was not applied.`,
  });

  // `addPrimitive` and `generateMesh` create rather than reference, so there is nothing to resolve.
  if (name === 'generateTexture') {
    const { objectId } = input as { readonly objectId: string };
    if (!byId.has(objectId)) return missing(objectId);
  }

  if (name === 'setTransform' || name === 'setMaterialProperty' || name === 'applyModifier') {
    const { objectId } = input as { readonly objectId: string };
    if (!byId.has(objectId)) return missing(objectId);
  }

  if (name === 'deleteObject') {
    const { objectId, recursive } = input as {
      readonly objectId: string;
      readonly recursive: boolean;
    };
    const target = byId.get(objectId);
    if (!target) return missing(objectId);
    // FR-3.1: a subtree is never deleted by implication. The model must say it means the children.
    if (target.childCount > 0 && !recursive) {
      return {
        reason: 'OBJECT_HAS_CHILDREN',
        message: `"${target.name}" has ${target.childCount} child object(s). Deleting it would remove them too, so the call was refused.`,
      };
    }
  }

  if (name === 'groupObjects') {
    const { objectIds } = input as { readonly objectIds: readonly string[] };
    for (const id of objectIds) {
      if (!byId.has(id)) return missing(id);
    }
  }

  return null;
}

/**
 * Validates a batch of proposed calls under one group id (§7.2).
 *
 * The batch is validated as a whole so every accepted call shares one `groupId`, and therefore one
 * undo step: "add a crate and make it metallic" must undo as one action, not two.
 *
 * A rejection does **not** abort the batch. A model that gets one call of three wrong should still
 * have the other two applied, with the third explained — discarding the whole instruction would be
 * the "silently skip" behaviour FR-11.3 prohibits, just at a coarser granularity.
 */
export function validateToolCalls(
  calls: readonly ProposedToolCall[],
  context: ValidationContext,
  /**
   * Reuses a group id minted for the enclosing instruction (§7.2).
   *
   * The Copilot's loop can cross several model calls for one instruction, and every command must land
   * in a single undo step. Passing the id in is what lets the loop keep that property; omitting it
   * mints a fresh one, which is the right behaviour for a one-shot batch.
   */
  groupId: string = newGroupId(),
): readonly ValidationOutcome[] {
  return calls.map((call) => validateToolCall(call, context, groupId));
}

