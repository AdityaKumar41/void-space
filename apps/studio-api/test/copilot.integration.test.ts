/**
 * The authenticated Studio-API surface, against a real database (§9.1, §5, FR-11.x, FR-14.x).
 *
 * Why this file exists separately from `ai.test.ts`: the default suites run with **no database and no
 * network**, which `harness.ts` explains, so the authenticated routes there are covered only up to
 * their rejection paths. Everything below the session check — the identity mirror, tenant-scoped
 * queries, RLS, and the writes that record a Copilot turn — is only exercised here.
 *
 * **Gated, because most checkouts have no data tier running.** Set `STUDIO_INTEGRATION=1` and bring up
 * `pnpm studio:dev:up` first:
 *
 *     STUDIO_INTEGRATION=1 pnpm --filter @void-space/studio-api test
 *
 * The gate is an explicit opt-in rather than "does the database answer?", because a suite that quietly
 * degrades to skipped when a connection fails reads as passing. It takes its URLs from the
 * repository-root `.env` — the same source `pnpm studio:api:dev` uses — so it tests the configuration
 * the product actually runs with, not the deliberately-unreachable ones the other suites use.
 *
 * Fixtures come from `@void-space/studio-db/testing`, which writes tenants through the platform client
 * and everything else through a tenant-scoped one, so these rows are subject to the same RLS policies
 * as production traffic. A fixture written as a superuser would pass even if the policies were wrong.
 */
import { withStudioTenant } from '@void-space/studio-db';
import {
  createStudioProject,
  createStudioTenant,
  destroyStudioTenant,
  type StudioTenantFixture,
} from '@void-space/studio-db/testing';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { buildTestApp, rootEnv } from './harness';

const root = rootEnv();

/** Absent until `.env` exists and the data tier has been migrated — which is why this file is gated. */
const dataTier = root['STUDIO_DATABASE_URL'];
const platformTier = root['STUDIO_PLATFORM_DATABASE_URL'];
const secret = root['STUDIO_JWT_ACCESS_SECRET'];

const enabled =
  process.env.STUDIO_INTEGRATION === '1' && Boolean(dataTier && platformTier && secret);

/**
 * The model the *scripted provider* reports having served.
 *
 * Deliberately a constant of its own rather than a reuse of `model`, because the §7.5 record stores
 * what the provider **reported** — not what this service asked for. That distinction is the difference
 * between a stored `CopilotMessage` being reproducible and merely being decorated: if the far end
 * serves a different snapshot than the one configured, the row has to say which one actually ran. On a
 * machine whose `.env` sets a floating alias the two visibly differ, which is what makes this assertion
 * a test of the distinction rather than of string equality.
 */
const SERVED_MODEL = 'claude-sonnet-4-5-20250929';

/**
 * The model this deployment is *configured* with.
 *
 * Read from `.env` rather than hard-coded so the assertion describes the configuration under test — a
 * hard-coded literal would turn a legitimate override into a failing test. It is asserted only on the
 * session route, which reports capability rather than history.
 */
const configuredModel = root['ANTHROPIC_MODEL'] ?? SERVED_MODEL;

/**
 * The real data tier, but a **scripted** provider.
 *
 * The database is under test here; the model is not. Pointing this at api.anthropic.com would cost
 * money, need a real key and fail whenever someone else's deploy was slow — and would tell us nothing
 * about whether the routes persist what they claim to.
 */
const AI_ENV = {
  STUDIO_DATABASE_URL: dataTier,
  STUDIO_PLATFORM_DATABASE_URL: platformTier,
  STUDIO_JWT_ACCESS_SECRET: secret,
  ANTHROPIC_API_KEY: 'sk-ant-scripted',
  VOIDSPACE_CLIENT_MODE: 'mock',
};

const ADD_CALL = {
  type: 'tool_use',
  id: 'call_add',
  name: 'addPrimitive',
  input: { kind: 'cube', name: 'Crate' },
};
const PUBLISH_CALL = {
  type: 'tool_use',
  id: 'call_pub',
  name: 'publish',
  input: { projectId: 'anything' },
};

/**
 * A transport that answers from a script, so the model's behaviour is an input rather than a variable.
 *
 * Two replies, because a tool_use response makes the loop iterate: the second call is what ends the
 * instruction with `end_turn`. That is also what makes the usage assertion meaningful — it is the sum
 * of two calls, not the value of one.
 */
function scriptedTransport() {
  const queue: unknown[] = [
    {
      status: 200,
      headers: { 'content-type': 'application/json' },
      body: {
        id: 'msg_1',
        model: SERVED_MODEL,
        content: [{ type: 'text', text: 'Adding a crate.' }, ADD_CALL, PUBLISH_CALL],
        stop_reason: 'tool_use',
        usage: { input_tokens: 100, output_tokens: 50 },
      },
    },
    {
      status: 200,
      headers: { 'content-type': 'application/json' },
      body: {
        id: 'msg_2',
        model: SERVED_MODEL,
        content: [{ type: 'text', text: 'Added one crate.' }],
        stop_reason: 'end_turn',
        usage: { input_tokens: 200, output_tokens: 20 },
      },
    },
  ];

  return {
    requests: [] as unknown[],
    async request(request: unknown): Promise<never> {
      this.requests.push(request);
      const next = queue.shift();
      if (next === undefined) throw new Error('scripted transport exhausted');
      return next as never;
    },
  };
}

const SCENE = {
  objects: [{ id: 'obj-crate', name: 'Crate', type: 'mesh', childCount: 0, materialIds: [] }],
  selection: [],
  unit: 'metre',
} as const;

describe.skipIf(!enabled)('the authenticated Studio API over a real database', () => {
  let app: FastifyInstance;
  let fixture: StudioTenantFixture;
  let projectId: string;
  let token: string;
  let sessionId: string;
  let assistantMessageId: string;

  const auth = (): Record<string, string> => ({ authorization: `Bearer ${token}` });

  beforeAll(async () => {
    const built = await buildTestApp(AI_ENV as never, { transport: scriptedTransport() as never });
    app = built.app;

    fixture = await createStudioTenant();
    projectId = await createStudioProject(fixture, 'Integration Crate');

    // Minted with the shared signing key, which is exactly how VOID·SPACE's own access token arrives
    // (§3.5.1) — the Studio holds no second credential for a Creator to manage.
    token = app.jwt.sign({
      sub: fixture.userId,
      tid: fixture.tenantId,
      roles: ['Creator'],
      typ: 'access',
    });
  });

  afterAll(async () => {
    await app.close();
    if (fixture) await destroyStudioTenant(fixture.tenantId);
  });

  it('resolves a session from a VOID·SPACE token and mirrors the identity (§3.5.1, §5.1)', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/studio/api/v1/projects',
      headers: auth(),
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    // The §5.1 mirror is created by `resolveSession`, not by a migration, so a Creator who existed in
    // VOID·SPACE before the Studio did works on their very first request.
    expect(body.items.map((item: { id: string }) => item.id)).toContain(projectId);
    /*
     * Only the data members of `links` survive serialization — `assetUrl` is a *function* on the bridge
     * and `JSON.stringify` drops it silently. Asserting on what is actually on the wire is the point of
     * a suite that reads the wire, and the wart is worth knowing: a client cannot build an asset URL
     * from this response, it has to be told one per row.
     */
    expect(body.links.consoleUrl).toBeTruthy();
    expect(body.links.catalogUrl).toContain('/catalog');
  });

  it('creates a project through the route, local-first by default (§2.1)', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/studio/api/v1/projects',
      headers: auth(),
      payload: { name: 'Made through the API' },
    });

    expect(response.statusCode).toBe(200);
    // The default is the point: a Creator who never asks for cloud sync never uploads a document.
    expect(response.json().project.storageMode).toBe('local');
  });

  it('scores the pre-publish check without a model, and says why (§7.3, FR-11.10)', async () => {
    // Blanked for this request only. No provider is a supported deployment, not a failure.
    const built = await buildTestApp({ ...AI_ENV, ANTHROPIC_API_KEY: undefined } as never);
    const response = await built.app.inject({
      method: 'POST',
      url: `/studio/api/v1/projects/${projectId}/audit`,
      headers: auth(),
      payload: {
        metrics: {
          totalPolycount: 900_000,
          objectCount: 4,
          materialCount: 6,
          textureResolutions: [4_096],
          maxHierarchyDepth: 2,
          unnamedObjects: 1,
          meshesWithoutUvs: 0,
        },
      },
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.usedModel).toBe(false);
    expect(body.modelSkippedBecause).toBe('no_ai_provider');
    // The score is still computed — it comes from the measurements, which is the whole reason it is
    // computed locally rather than asked of the model.
    expect(body.report.score).toBeLessThan(100);
    expect(
      body.report.issues.some((issue: { category: string }) => issue.category === 'polycount'),
    ).toBe(true);
    // No ProjectVersion exists for a `local` project, so §7.3's storage has nowhere to go yet — and the
    // response says so rather than inventing a version. The publish handoff records the same report on
    // the PublishRecord, which is what makes the gate auditable on this path.
    expect(body.storedOn).toBeNull();

    await built.app.close();
  });

  it('stores the §7.3 report against the ProjectVersion when one exists', async () => {
    const versionId = await withStudioTenant(fixture.tenantId, async (db) => {
      const version = await db.projectVersion.create({
        data: {
          tenantId: fixture.tenantId,
          projectId,
          versionNumber: 1,
          kind: 'explicit',
          createdById: fixture.userId,
        },
        select: { id: true },
      });
      return version.id;
    });

    const built = await buildTestApp({ ...AI_ENV, ANTHROPIC_API_KEY: undefined } as never);
    const response = await built.app.inject({
      method: 'POST',
      url: `/studio/api/v1/projects/${projectId}/audit`,
      headers: auth(),
      payload: {
        metrics: {
          totalPolycount: 1_000,
          objectCount: 2,
          materialCount: 1,
          textureResolutions: [1_024],
          maxHierarchyDepth: 1,
          unnamedObjects: 0,
          meshesWithoutUvs: 0,
        },
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().storedOn).toEqual({ versionId, versionNumber: 1 });

    const stored = await withStudioTenant(fixture.tenantId, (db) =>
      db.projectVersion.findUnique({
        where: { id: versionId },
        select: { readinessScore: true, readinessRunAt: true },
      }),
    );
    // The score is an indexed column rather than a key inside the report JSON, so "which versions are
    // below threshold" is a query and the stored number cannot drift from the report it came from.
    expect(stored?.readinessScore).toBe(response.json().report.score);
    expect(stored?.readinessRunAt).not.toBeNull();

    await built.app.close();
  });

  it('opens a Copilot session against the project (§7.2, FR-11.1)', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/studio/api/v1/copilot/sessions',
      headers: auth(),
      payload: { projectId, title: 'Crate pass' },
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.project.id).toBe(projectId);
    expect(body.session.title).toBe('Crate pass');
    /*
     * Assigned before the assertion, deliberately. A failing assertion must not leave `sessionId`
     * unset, because every later case would then send `undefined` in the path, fail with a 400
     * validation error, and point the investigation at the wrong route entirely.
     */
    sessionId = body.session.id;
    // Reported so the panel can say the Copilot is available before a Creator types.
    expect(body.model).toBe(configuredModel);
  });

  it('runs an instruction, refuses the publish inside it, and records the turn (§7.1–7.5)', async () => {
    const response = await app.inject({
      method: 'POST',
      url: `/studio/api/v1/copilot/sessions/${sessionId}/messages`,
      headers: auth(),
      payload: { instruction: 'add a crate and publish it', scene: SCENE },
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();

    // §7.1 — the service proposes; it never applies. The editor's command system is the only thing that
    // mutates the document, which is why nothing here returns a scene.
    expect(body.applied.map((call: { name: string }) => call.name)).toEqual(['addPrimitive']);
    expect(body.rejected[0]?.reason).toBe('PUBLISH_REQUIRES_HUMAN_ACTION');
    expect(body.stopReason).toBe('end_turn');

    // §7.2 — one undo step for one sentence, across both model round trips.
    expect(body.applied[0]?.groupId).toMatch(/^cg-/);

    // Captured before the assertions for the same reason as `sessionId` above: a later case must not
    // inherit `undefined` because an earlier expectation failed.
    assistantMessageId = body.messages.assistant.id;

    // §7.5 — the invocation log is *stored*, with the model and the prompt-template version, and the
    // usage is the sum of both calls rather than the value of the last one.
    expect(body.invocation.model).toBe(SERVED_MODEL);
    expect(body.invocation.promptVersion).toBe('copilot.system.v1');
    expect(body.invocation.usage).toEqual({ inputTokens: 300, outputTokens: 70 });
    expect(assistantMessageId).toBeTruthy();
  });

  it('reads the transcript back with the refusals intact (FR-11.3, FR-11.4)', async () => {
    const response = await app.inject({
      method: 'GET',
      url: `/studio/api/v1/copilot/sessions/${sessionId}`,
      headers: auth(),
    });

    expect(response.statusCode).toBe(200);
    const messages = response.json().messages as {
      role: string;
      content: string;
      toolCalls: { name: string; status: string; reason?: string }[];
      model: string | null;
      promptVersion: string | null;
    }[];

    expect(messages).toHaveLength(2);
    expect(messages[0]?.role).toBe('user');
    expect(messages[0]?.content).toBe('add a crate and publish it');

    const assistant = messages[1];
    // Stored rather than dropped: §7.2 requires a refusal to be explained, and an explanation that is
    // not persisted cannot be shown after a reload — which is when a Creator most wants it.
    const refusal = assistant?.toolCalls.find((call) => call.name === 'publish');
    expect(refusal?.status).toBe('rejected');
    expect(refusal?.reason).toBe('PUBLISH_REQUIRES_HUMAN_ACTION');
    expect(assistant?.model).toBe(SERVED_MODEL);
    expect(assistant?.promptVersion).toBe('copilot.system.v1');
  });

  it('links an applied command to the message that produced it (FR-11.4)', async () => {
    const response = await app.inject({
      method: 'POST',
      url: `/studio/api/v1/copilot/sessions/${sessionId}/messages/${assistantMessageId}/applied`,
      headers: auth(),
      payload: { appliedCommandIds: ['cmd-1', 'cmd-2'] },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().appliedCommandIds).toEqual(['cmd-1', 'cmd-2']);

    // Reported twice, as the editor applies per iteration and reports in batches. Merged rather than
    // replaced: replacing would drop the ids of everything applied before the second report, which is
    // exactly the audit trail FR-11.4 exists to keep.
    const second = await app.inject({
      method: 'POST',
      url: `/studio/api/v1/copilot/sessions/${sessionId}/messages/${assistantMessageId}/applied`,
      headers: auth(),
      payload: { appliedCommandIds: ['cmd-2', 'cmd-3'] },
    });
    expect(second.json().appliedCommandIds).toEqual(['cmd-1', 'cmd-2', 'cmd-3']);
  });

  it('cannot reach another tenant’s session through a valid token (§5.2, defence in depth)', async () => {
    const other = await createStudioTenant();
    const otherToken = app.jwt.sign({
      sub: other.userId,
      tid: other.tenantId,
      roles: ['Creator'],
      typ: 'access',
    });

    const response = await app.inject({
      method: 'GET',
      url: `/studio/api/v1/copilot/sessions/${sessionId}`,
      headers: { authorization: `Bearer ${otherToken}` },
    });

    // RLS plus the tenant-scoped client: the row is not visible to another tenant, so this is a 404
    // rather than a leak. A 403 would also be defensible; a 200 would be the bug.
    expect(response.statusCode).toBe(404);
    expect(response.json().code).toBe('NOT_FOUND');

    await destroyStudioTenant(other.tenantId);
  });

  it('carries a publish through the handoff and writes its lineage (FR-14.2/14.3)', async () => {
    // The §9.1 simulator, end to end. This is the write path the DB-free suites could only review by
    // construction, and it is the only place the studio database and the VOID·SPACE gateway meet.
    const fileBase64 = Buffer.from([1, 2, 3, 4]).toString('base64');
    const response = await app.inject({
      method: 'POST',
      url: `/studio/api/v1/projects/${projectId}/publish`,
      headers: auth(),
      payload: {
        name: 'Integration Crate',
        category: 'Prop',
        export: {
          extension: '.glb',
          sizeBytes: 4,
          polycount: 1_000,
          textureResolutions: [1_024],
          materialCount: 1,
          gltfHeaderValid: true,
          unsupportedMaterialFeatures: [],
        },
        readiness: { score: 88, passed: true, threshold: 70, issues: [] },
        fileBase64,
        filename: 'crate.glb',
      },
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    // An upload lands `pending`, not `published`: the licence is minted by a worker, so a status that
    // jumped ahead would train the Studio's status strip on a future it never sees.
    expect(body.publish.status).toBe('pending');
    expect(body.publish.voidspaceAssetId).toBeTruthy();
    // FR-14.3 — the hash is what makes the *artifact* the thing that was verified, not the row.
    expect(body.publish.exportSha256).toMatch(/^[0-9a-f]{64}$/);
    expect(body.gate.warnings).toEqual([]);

    const status = await app.inject({
      method: 'GET',
      url: `/studio/api/v1/projects/${projectId}/publish-status`,
      headers: auth(),
    });
    expect(status.statusCode).toBe(200);
    expect(status.json().url).toContain('/catalog/');
    expect(status.json().syncError).toBeNull();
  });
});

describe.skipIf(enabled)('the integration suite explains itself when skipped', () => {
  it('says how to run it', () => {
    // A skipped suite is invisible in most output, so the reason is asserted rather than assumed. This
    // is why the gate is an explicit flag and not "did the database answer?" — a suite that silently
    // degrades to skipped when a connection fails reads as passing.
    expect(enabled).toBe(false);
  });
});
