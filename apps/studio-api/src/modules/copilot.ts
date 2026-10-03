/**
 * The Copilot surface (VS2-SRS-1.0 §7.1–7.5, FR-11.1–11.5, §5 `CopilotSession`/`CopilotMessage`).
 *
 * This module is where §7.1 stops being a principle and becomes a wire format. The rule is **AI
 * proposes, the command system applies**, and the split falls along this boundary exactly:
 *
 *   - This service owns the **model credential** and the conversation. It runs the tool-use loop,
 *     validates every call (FR-11.3), and records the transcript.
 *   - The **editor** owns the scene and the commands. The route returns the validated calls it
 *     accepted; the editor applies them as ordinary undoable Commands and reports back the command
 *     ids through `/messages/:messageId/applied`, which is FR-11.4's link from a model decision to
 *     the undo step that reverses it.
 *
 * That is why the loop is run **without** an `applyCommands` callback here. Supplying one would mean
 * this service mutating a document it has never seen, which §2.2 says it does not store. The
 * consequence is honest and worth naming: a multi-step instruction ("add a crate and make **it**
 * metallic") cannot resolve "it" in one request, because the crate's id only exists after the editor
 * has run the first command. The editor's panel is what closes that loop.
 *
 * Refusals that do not need a model are made *before* the call. A Viewer who cannot edit, a tenant
 * with the feature switched off, and a deployment with no provider are all answered without spending
 * a token — §7.5's controls are about cost, and the cheapest refusal is the one never sent.
 */
import { withStudioTenant } from '@void-space/studio-db';
import {
  InMemoryInvocationSink,
  runCopilot,
  type AiInvocationLog,
  type CopilotStep,
} from '@void-space/studio-ai';
import type { SceneSummary } from '@void-space/studio-engine';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';

import { resolveTenantAiFeatures, tenantHasAiFeature, type StudioAi } from '../lib/ai';
import { ForbiddenError, NotFoundError, ValidationError } from '../lib/errors';
import { parseBody, parseParams, parseQuery } from '../lib/http';
import { requirePermission, resolveSession, type StudioSession } from '../lib/session';

const sessionParamsSchema = z.object({ sessionId: z.string().uuid() });
const messageParamsSchema = z.object({
  sessionId: z.string().uuid(),
  messageId: z.string().uuid(),
});

const createSessionSchema = z.object({
  projectId: z.string().uuid(),
  /** FR-11.1 — a label the panel can show after a reload. */
  title: z.string().min(1).max(200).optional(),
});

const transcriptQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50),
});

/**
 * The §7.2 scene summary, validated server-side.
 *
 * Not passed through as `unknown`: §7.2 requires the model to be shown *this* summary and the
 * validator to check calls against *the same* object, so an unvalidated body would let a caller hand
 * the model one scene and the validator another — the exact gap that makes a call valid on paper and
 * wrong in the editor.
 */
const sceneSummarySchema = z.object({
  objects: z
    .array(
      z.object({
        id: z.string().min(1).max(128),
        name: z.string().max(200),
        type: z.enum(['mesh', 'light', 'camera', 'empty', 'armature']),
        childCount: z.number().int().nonnegative(),
        materialIds: z.array(z.string().min(1).max(128)).max(64),
      }),
    )
    .max(5_000),
  selection: z.array(z.string().min(1).max(128)).max(500),
  unit: z.enum(['metre', 'centimetre']),
});

const runMessageSchema = z.object({
  instruction: z.string().min(1).max(4_000),
  scene: sceneSummarySchema,
  /**
   * A tighter budget than the deployment's for this one instruction.
   *
   * Capped well below what the policy allows, because it is a *tighter* override by definition:
   * accepting a larger value would turn a request body into a way around §7.5's cost ceiling.
   */
  maxIterations: z.number().int().min(1).max(6).optional(),
});

const appliedSchema = z.object({
  /** FR-11.4 — the undoable command ids this message's accepted calls produced. */
  appliedCommandIds: z.array(z.string().min(1).max(128)).max(200),
});

export interface CopilotRoutesOptions {
  readonly ai: StudioAi;
}

/**
 * One row per proposed call, carrying its validation outcome (FR-11.3).
 *
 * Rejected calls are kept, not dropped, because §7.2 requires a refusal to be *explained* — and an
 * explanation that is not stored cannot be shown after a reload, which is when a Creator most wants
 * to know why the assistant did not do what they asked.
 */
export interface ToolCallRecord {
  readonly id: string | undefined;
  readonly name: string;
  readonly input: unknown;
  readonly status: 'accepted' | 'rejected';
  readonly groupId?: string;
  readonly reason?: string;
  readonly message?: string;
}

export function toolCallRecords(steps: readonly CopilotStep[]): ToolCallRecord[] {
  const records: ToolCallRecord[] = [];

  for (const step of steps) {
    for (const outcome of step.outcomes) {
      // The proposal is the only place `input` survives: an outcome carries the verdict, not the
      // arguments, and FR-11.4's audit needs both to be reviewable.
      const proposal = step.proposed.find((call) => call.id === outcome.id);

      records.push(
        outcome.status === 'accepted'
          ? {
              id: outcome.id,
              name: proposal?.name ?? 'unknown',
              input: proposal?.input ?? null,
              status: 'accepted',
              groupId: outcome.groupId,
            }
          : {
              id: outcome.id,
              name: proposal?.name ?? 'unknown',
              input: proposal?.input ?? null,
              status: 'rejected',
              reason: outcome.reason,
              message: outcome.message,
            },
      );
    }
  }

  return records;
}

/**
 * Flattens several model calls into the one set of §7.5 columns a `CopilotMessage` row carries.
 *
 * §7.5 requires each request/response pair to be logged with its model and prompt-template version.
 * The row is per *message* while the calls are per *iteration*, so a multi-round-trip instruction
 * produces several entries and one row: durations and token counts are summed, models are collected,
 * and a partial failure is preserved rather than rounded up to success. Summing rather than taking
 * the last entry is what keeps the stored cost a description of the instruction rather than of its
 * final round trip.
 */
export function summarizeInvocation(entries: readonly AiInvocationLog[]): {
  readonly provider: string | null;
  readonly model: string | null;
  readonly promptVersion: string | null;
  readonly durationMs: number | null;
  readonly ok: boolean | null;
  readonly failureKind: string | null;
  readonly usage: { readonly inputTokens: number; readonly outputTokens: number } | null;
  readonly redacted: readonly string[];
} {
  if (entries.length === 0) {
    return {
      provider: null,
      model: null,
      promptVersion: null,
      durationMs: null,
      ok: null,
      failureKind: null,
      usage: null,
      redacted: [],
    };
  }

  const models = [...new Set(entries.map((entry) => entry.model))];
  const versions = [...new Set(entries.map((entry) => entry.promptVersion))];
  const failed = entries.find((entry) => !entry.ok);
  const usage = entries.reduce(
    (total, entry) => ({
      inputTokens: total.inputTokens + (entry.usage?.inputTokens ?? 0),
      outputTokens: total.outputTokens + (entry.usage?.outputTokens ?? 0),
    }),
    { inputTokens: 0, outputTokens: 0 },
  );

  return {
    provider: entries[0]?.provider ?? null,
    // Joined when they differ, so a model that changed mid-instruction is visible instead of being
    // silently attributed to whichever one happened to go first.
    model: models.join(', ') || null,
    promptVersion: versions.join(', ') || null,
    durationMs: entries.reduce((total, entry) => total + entry.durationMs, 0),
    ok: failed === undefined,
    failureKind: failed?.failureKind ?? null,
    usage,
    redacted: [...new Set(entries.flatMap((entry) => entry.redacted))],
  };
}

export async function copilotRoutes(
  app: FastifyInstance,
  options: CopilotRoutesOptions,
): Promise<void> {
  const { ai } = options;

  const session = async (request: FastifyRequest): Promise<StudioSession> => {
    if (request.session) return request.session;
    const resolved = await resolveSession(app, request);
    request.session = resolved;
    return resolved;
  };

  /**
   * FR-18.1's flags for a tenant, read per request and never cached.
   *
   * "Never cached" is a requirement rather than a preference: §7.5 says a TenantAdmin can disable a
   * feature tenant-wide, and the useful promise is that it takes effect on the next call — not after
   * a restart, and not after a cache expires.
   */
  const tenantAiFlags = async (tenantId: string): Promise<unknown> => {
    const row = await withStudioTenant(tenantId, (db) =>
      db.tenant.findUnique({ where: { id: tenantId }, select: { aiFeatureFlags: true } }),
    );
    return row?.aiFeatureFlags ?? {};
  };

  /** FR-11.1 — opens a conversation against a project. */
  app.post('/copilot/sessions', async (request: FastifyRequest) => {
    const me = await session(request);
    requirePermission(me, 'asset:upload-own');
    const body = parseBody(createSessionSchema, request.body);

    // Checked rather than left to the foreign key: a missing project would otherwise surface as a
    // driver error under a 500, which reads as this service being broken rather than as the request
    // naming a project that is not there.
    const project = await withStudioTenant(me.tenantId, (db) =>
      db.project.findUnique({ where: { id: body.projectId }, select: { id: true, name: true } }),
    );
    if (!project) throw new NotFoundError('Project');

    const created = await withStudioTenant(me.tenantId, (db) =>
      db.copilotSession.create({
        data: {
          tenantId: me.tenantId,
          projectId: project.id,
          userId: me.userId,
          ...(body.title === undefined ? {} : { title: body.title }),
        },
        select: { id: true, projectId: true, title: true, startedAt: true },
      }),
    );

    return {
      session: created,
      project: { id: project.id, name: project.name },
      /** Null when no provider is configured, so the panel can say so before a Creator types. */
      model: ai.configured ? ai.model : null,
    };
  });

  /** FR-11.4 — the transcript, which is what makes a past instruction reviewable after a reload. */
  app.get('/copilot/sessions/:sessionId', async (request: FastifyRequest) => {
    const me = await session(request);
    const { sessionId } = parseParams(sessionParamsSchema, request.params);
    const query = parseQuery(transcriptQuerySchema, request.query ?? {});

    const found = await withStudioTenant(me.tenantId, (db) =>
      db.copilotSession.findUnique({
        where: { id: sessionId },
        select: {
          id: true,
          projectId: true,
          title: true,
          startedAt: true,
          endedAt: true,
          // Oldest first: a transcript is read forwards.
          messages: {
            orderBy: { createdAt: 'asc' },
            take: query.limit,
            select: {
              id: true,
              role: true,
              content: true,
              toolCalls: true,
              appliedCommandIds: true,
              provider: true,
              model: true,
              promptVersion: true,
              durationMs: true,
              ok: true,
              failureKind: true,
              usage: true,
              redacted: true,
              createdAt: true,
            },
          },
        },
      }),
    );
    if (!found) throw new NotFoundError('Copilot session');

    return { ...found, model: ai.configured ? ai.model : null };
  });
  /**
   * FR-11.1–11.3 — one instruction through the Copilot loop.
   *
   * Returns the *validated calls*, not an edited scene: the editor applies them through its own
   * Command objects. See the file header for why this route deliberately applies nothing itself.
   */
  app.post('/copilot/sessions/:sessionId/messages', async (request: FastifyRequest) => {
    const me = await session(request);
    const { sessionId } = parseParams(sessionParamsSchema, request.params);
    const body = parseBody(runMessageSchema, request.body);

    /*
     * Every refusal that does not need a model happens before the model is called, in this order:
     *
     *   1. permission — `asset:upload-own` is the §3.6 matrix's "upload / edit own assets", which is
     *      exactly what an instruction that mutates the scene requires.
     *   2. the feature flag (FR-18.1) — a tenant with the Copilot switched off must not be billed for
     *      discovering that.
     *   3. a configured provider.
     *
     * §7.5's controls are about cost, and the cheapest refusal is the one never sent.
     */
    requirePermission(me, 'asset:upload-own');
    ai.requireConfigured('copilot');

    const opened = await withStudioTenant(me.tenantId, (db) =>
      db.copilotSession.findUnique({ where: { id: sessionId }, select: { id: true } }),
    );
    if (!opened) throw new NotFoundError('Copilot session');

    const flags = await tenantAiFlags(me.tenantId);
    if (!tenantHasAiFeature(flags, 'copilot')) {
      throw new ForbiddenError(
        'The Copilot is disabled for your workspace (FR-18.1). A TenantAdmin can enable it under AI features.',
        'AI_FEATURE_DISABLED',
        { feature: 'copilot' },
      );
    }

    // Resolved from the tenant row rather than the request, and *kept* rather than folded into the
    // check above: it is what the validator uses to refuse a feature-gated tool (FR-18.1), so a
    // disabled `generativeMesh` is refused as a tool call even though the Copilot itself is on.
    const enabledAiFeatures = resolveTenantAiFeatures(flags);

    const sink = new InMemoryInvocationSink();

    const run = await runCopilot(ai.claudeFor(sink), {
      tenantId: me.tenantId,
      userId: me.userId,
      instruction: body.instruction,
      scene: body.scene satisfies SceneSummary,
      /*
       * Established by `requirePermission` above. It stays in the context because the validator is
       * also reachable from the worker and from a suite, where no route ran a check first — this is
       * the backstop, not the only gate.
       */
      canEditProject: true,
      ...(enabledAiFeatures === undefined ? {} : { enabledAiFeatures }),
      ...(body.maxIterations === undefined ? {} : { maxIterations: body.maxIterations }),
    });

    const invocation = summarizeInvocation(sink.entries);
    const toolCalls = toolCallRecords(run.steps);

    const persisted = await withStudioTenant(me.tenantId, async (db) => {
      const user = await db.copilotMessage.create({
        data: { tenantId: me.tenantId, sessionId, role: 'user', content: body.instruction },
        select: { id: true, createdAt: true },
      });

      const assistant = await db.copilotMessage.create({
        data: {
          tenantId: me.tenantId,
          sessionId,
          role: 'assistant',
          content: run.steps.flatMap((step) => step.assistantText).join('\n\n'),
          toolCalls: toolCalls as never,
          // FR-11.4's link is filled in by the `/applied` route below: only the editor can mint a
          // command id, so it cannot be known at the moment this row is written.
          appliedCommandIds: [] as never,
          provider: invocation.provider,
          model: invocation.model,
          promptVersion: invocation.promptVersion,
          durationMs: invocation.durationMs,
          ok: invocation.ok,
          failureKind: invocation.failureKind,
          redacted: invocation.redacted as never,
          ...(invocation.usage === null ? {} : { usage: invocation.usage as never }),
        },
        select: { id: true, content: true, toolCalls: true, createdAt: true },
      });

      return { user, assistant };
    });

    return {
      session: { id: sessionId },
      messages: persisted,
      /** What the editor applies. The assistant's prose is not an instruction to act on. */
      applied: run.applied,
      rejected: run.rejected,
      stopReason: run.stopReason,
      ...(run.error === undefined ? {} : { error: run.error }),
      model: run.model,
      promptVersion: run.promptVersion,
      toolSchemaVersion: run.toolSchemaVersion,
      modelCalls: run.modelCalls,
      usage: run.usage,
      /** §7.5's record of the call, exactly as it was stored on the message. */
      invocation,
    };
  });

  /**
   * FR-11.4 — the editor reports which commands the accepted calls produced.
   *
   * Merged rather than replaced. The editor applies per iteration and may report in batches, so a
   * second report is new information rather than a correction of the first; replacing would silently
   * drop the ids of everything applied before it, which is precisely the audit trail FR-11.4 exists
   * to keep.
   */
  app.post(
    '/copilot/sessions/:sessionId/messages/:messageId/applied',
    async (request: FastifyRequest) => {
      const me = await session(request);
      const { sessionId, messageId } = parseParams(messageParamsSchema, request.params);
      const body = parseBody(appliedSchema, request.body);
      requirePermission(me, 'asset:upload-own');

      const message = await withStudioTenant(me.tenantId, (db) =>
        db.copilotMessage.findFirst({
          where: { id: messageId, sessionId },
          select: { id: true, role: true, appliedCommandIds: true },
        }),
      );
      if (!message) throw new NotFoundError('Copilot message');

      // Only an assistant message can carry the link: an id reported against the user's own
      // instruction would attribute a command to the sentence that asked for it rather than to the
      // decision that produced it.
      if (message.role !== 'assistant') {
        throw new ValidationError('Only an assistant message records applied commands.');
      }

      const existing = Array.isArray(message.appliedCommandIds)
        ? (message.appliedCommandIds as string[])
        : [];

      const merged = [...new Set([...existing, ...body.appliedCommandIds])];

      return withStudioTenant(me.tenantId, (db) =>
        db.copilotMessage.update({
          where: { id: messageId },
          data: { appliedCommandIds: merged as never },
          select: { id: true, appliedCommandIds: true },
        }),
      );
    },
  );
}
