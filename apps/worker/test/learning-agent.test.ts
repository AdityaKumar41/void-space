import { randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import { beforeAll, beforeEach, afterAll, describe, it, expect } from 'vitest';
import { withTenant, demoId } from '@void-space/db';
import { lessonTemplate } from '@void-space/types';
import type { Job } from 'bullmq';
import { createLearningProcessor } from '../src/processors/learning';
import { processLearningAgent } from '../src/learning/agent';
import { finalizeLearningFailure } from '../src/learning/durable';
const tenant = demoId('tenant:aurora');
let owner = '',
  url = '',
  sourceId = '';
const threadIds: string[] = [],
  taskIds: string[] = [],
  jobIds: string[] = [],
  planIds: string[] = [],
  responses: unknown[] = [],
  requests: unknown[] = [];
const server = createServer((req, res) => {
  let body = '';
  req.on('data', (c) => (body += c));
  req.on('end', () => {
    const payload = JSON.parse(body);
    requests.push(payload);
    const next = responses.shift();
    const content =
      next && typeof next === 'object' && 'labels' in next && !payload.response_format
        ? `Here are the proposed labels:\n\`\`\`json\n${JSON.stringify(next)}\n\`\`\``
        : JSON.stringify(next);
    res.setHeader('content-type', 'application/json');
    res.end(
      JSON.stringify({
        choices: [{ message: { content }, finish_reason: 'stop' }],
        model: 'local-agent-test',
      }),
    );
  });
});
const config = () => ({
  AI_TEXT_BASE_URL: url,
  AI_TEXT_MODEL: 'local-agent-test',
  AI_TEXT_PROTOCOL: 'openai' as const,
});
beforeEach(() => {
  responses.length = 0;
});
beforeAll(async () => {
  owner = await withTenant(
    tenant,
    async (db) => (await db.user.findFirstOrThrow({ where: { email: 'creator@aurora.dev' } })).id,
  );
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  url = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  sourceId = (
    await withTenant(tenant, (db) =>
      db.learningSource.create({
        data: {
          tenantId: tenant,
          ownerId: owner,
          title: 'Reviewed electrical notes',
          mime: 'text/plain',
          passages: [
            {
              id: 'p1',
              page: 1,
              text: 'A switch can open a circuit, interrupting the current path.',
            },
          ],
        },
      }),
    )
  ).id;
});
afterAll(async () => {
  await new Promise<void>((resolve, reject) => server.close((e) => (e ? reject(e) : resolve())));
  await withTenant(tenant, async (db) => {
    await db.job.deleteMany({ where: { id: { in: jobIds } } });
    await db.lessonPlan.deleteMany({ where: { id: { in: planIds } } });
    await db.learningThread.deleteMany({ where: { id: { in: threadIds } } });
    await db.learningTask.deleteMany({ where: { id: { in: taskIds } } });
    if (sourceId) await db.learningSource.deleteMany({ where: { id: sourceId } });
  });
});
async function fixture(sourceIds: string[] = []) {
  const taskId = randomUUID();
  taskIds.push(taskId);
  const thread = await withTenant(tenant, (db) =>
    db.learningThread.create({
      data: {
        tenantId: tenant,
        ownerId: owner,
        title: 'Agent unit flow',
        messages: [{ role: 'user', content: 'Create a lesson', taskId }],
      },
    }),
  );
  threadIds.push(thread.id);
  await withTenant(tenant, (db) =>
    db.learningTask.create({
      data: { id: taskId, tenantId: tenant, ownerId: owner, kind: 'agent_turn', input: {} },
    }),
  );
  return {
    taskId,
    input: {
      threadId: thread.id,
      messages: [{ role: 'user', content: 'Create a lesson' }],
      context: {
        message: 'Create a 30-minute lesson about electricity',
        durationMinutes: 30,
        audience: 'Learners aged 13+',
        sourceIds,
      },
    },
  };
}
describe('personal agent invokes bounded learning tools', () => {
  it('preserves the actual recovery reason and stops working indicators when retries finish', async () => {
    const f = await fixture();
    const error =
      'The AI provider did not return a complete valid draft. No changes were applied. Retry or continue editing manually.';
    await withTenant(tenant, (db) =>
      db.learningTask.update({
        where: { id: f.taskId },
        data: {
          status: 'queued',
          error,
          progress: [
            { id: 'tool-label_model', label: 'Examining model components', status: 'working' },
          ],
        },
      }),
    );
    await finalizeLearningFailure({ tenantId: tenant, taskId: f.taskId, ownerId: owner });
    const failed = await withTenant(tenant, (db) =>
      db.learningTask.findUniqueOrThrow({ where: { id: f.taskId } }),
    );
    expect(failed.status).toBe('failed');
    expect(failed.error).toBe(error);
    expect(failed.progress).toEqual([expect.objectContaining({ status: 'failed' })]);
    await withTenant(tenant, (db) =>
      db.learningTask.update({
        where: { id: f.taskId },
        data: { status: 'cancelled', error: null },
      }),
    );
    await finalizeLearningFailure({ tenantId: tenant, taskId: f.taskId, ownerId: owner });
    expect(
      (
        await withTenant(tenant, (db) =>
          db.learningTask.findUniqueOrThrow({ where: { id: f.taskId } }),
        )
      ).status,
    ).toBe('cancelled');
  });
  it('keeps annotation requests out of lesson creation and preserves unselected pins', async () => {
    const f = await fixture();
    const modelId = randomUUID();
    const other = {
      id: 'unchanged',
      meshKey: 'mesh-0',
      label: 'Other pin',
      explanation: 'Existing reviewed explanation.',
      position: [0.2, 0.3, 0.1],
      confidence: 'named',
    };
    responses.push(
      { message: 'I will revise this annotation.', action: 'create_lesson' },
      {
        labels: [
          {
            id: 'selected',
            meshKey: 'mesh-0',
            label: 'Revised surface',
            explanation: 'A revised explanation for the selected pin.',
            position: [0.1, 0.1, 0.2],
            confidence: 'named',
          },
        ],
      },
    );
    const result = await processLearningAgent(
      tenant,
      f.taskId,
      owner,
      {
        ...f.input,
        context: {
          ...f.input.context,
          annotationWorkspace: true,
          selectedAnnotationId: 'selected',
          privateModelId: modelId,
          model: {
            id: modelId,
            title: 'Synthetic cube',
            metadata: {
              revision: 12,
              parts: [{ key: 'mesh-0', name: 'Cube' }],
              labels: [{ ...other, id: 'selected' }, other],
            },
          },
        },
      },
      config(),
    );
    expect(result.planId).toBeUndefined();
    expect(result.modelRevision).toBe(12);
    expect(result.labels).toEqual([
      expect.objectContaining({ id: 'selected', label: 'Revised surface' }),
      other,
    ]);
    expect(JSON.stringify(requests.at(-1))).toContain('existingAnnotations');
  });
  it('requests machine-readable label proposals rather than accepting fenced prose', async () => {
    const f = await fixture();
    const modelId = randomUUID();
    const input = {
      ...f.input,
      context: {
        ...f.input.context,
        privateModelId: modelId,
        model: {
          id: modelId,
          title: 'Synthetic sphere',
          metadata: { parts: [{ key: 'mesh-0', name: 'Sphere' }] },
        },
      },
    };
    responses.push(
      { message: 'I will propose labels.', action: 'label_model' },
      {
        labels: [
          {
            id: 'surface',
            meshKey: 'mesh-0',
            label: 'Sphere surface',
            explanation: 'Confirm this geometric surface before sharing.',
            position: [0, 0, 0],
            confidence: 'named',
          },
        ],
      },
    );
    const result = await processLearningAgent(tenant, f.taskId, owner, input, config());
    expect(result.labels).toHaveLength(1);
    expect(result.modelId).toBe(modelId);
    expect(requests.at(-1)).toMatchObject({ response_format: { type: 'json_object' } });
  });

  it('creates a real private lesson from chat exactly once', async () => {
    const f = await fixture();
    responses.push(
      {
        message: 'I will prepare a lesson.',
        action: 'create_lesson',
        topic: 'Electricity',
        durationMinutes: 30,
        audience: 'Learners aged 13+',
      },
      lessonTemplate({
        topic: 'Electricity',
        audience: 'Learners aged 13+',
        durationMinutes: 30,
        instructions: '',
        sourceIds: [],
      }),
    );
    const result = await processLearningAgent(tenant, f.taskId, owner, f.input, config());
    planIds.push(result.planId as string);
    expect(result.planId).toBeTruthy();
    const task = await withTenant(tenant, (db) =>
      db.learningTask.findUniqueOrThrow({ where: { id: f.taskId } }),
    );
    expect(task.progress).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: 'context', status: 'complete' }),
        expect.objectContaining({ id: 'understand', status: 'complete' }),
        expect.objectContaining({ id: 'tool-create_lesson', status: 'complete' }),
        expect.objectContaining({ id: 'write', status: 'complete' }),
        expect.objectContaining({ id: 'check', status: 'complete' }),
      ]),
    );
    expect((task.progress as { status: string }[]).some((s) => s.status === 'working')).toBe(false);
    const usage = (task.progress as { id: string; usage?: Record<string, unknown> }[]).find(
      (s) => s.id === 'usage-coordinator',
    )!.usage!;
    expect(Object.keys(usage).sort()).toEqual(['inputTokens', 'model', 'outputTokens', 'provider']);

    const count = requests.length;
    const repeat = await processLearningAgent(tenant, f.taskId, owner, f.input, config());
    expect(repeat.planId).toBe(result.planId);
    expect(requests.length).toBe(count);
    const thread = await withTenant(tenant, (db) =>
      db.learningThread.findUniqueOrThrow({ where: { id: f.input.threadId } }),
    );
    expect(thread.messages as unknown[]).toHaveLength(2);
  });
  it('grounds ordinary attached-source replies in actual private passages and validates citations', async () => {
    const f = await fixture([sourceId]);
    responses.push({
      message: 'A switch opens the circuit and interrupts the current path.',
      action: 'respond',
      citations: [{ sourceId, passageId: 'p1' }],
    });
    const result = await processLearningAgent(tenant, f.taskId, owner, f.input, config());
    expect(result.sources).toMatchObject([{ title: 'Reviewed electrical notes', page: 1 }]);
    expect(JSON.stringify(requests.at(-1))).toContain('interrupting the current path');
    const invalid = await fixture([sourceId]);
    responses.push({
      message: 'An invented claim',
      action: 'respond',
      citations: [{ sourceId, passageId: 'fake' }],
    });
    await expect(
      processLearningAgent(tenant, invalid.taskId, owner, invalid.input, config()),
    ).rejects.toThrow('valid response');
  });
  it('cannot turn generated tool names into publication or arbitrary actions', async () => {
    const f = await fixture();
    responses.push({ message: 'Publish everything', action: 'publish' });
    await expect(processLearningAgent(tenant, f.taskId, owner, f.input, config())).rejects.toThrow(
      'valid response',
    );
  });
  it('distinguishes retryable and terminal tool failures, then resumes real progress', async () => {
    const run = createLearningProcessor({
      textAi: config(),
      stagingDir: '/private/tmp/void-progress-tests',
    });
    async function queued(attempts: number) {
      const f = await fixture(),
        jobId = randomUUID();
      jobIds.push(jobId);
      await withTenant(tenant, async (db) => {
        await db.learningTask.update({ where: { id: f.taskId }, data: { input: f.input } });
        await db.job.create({
          data: {
            id: jobId,
            tenantId: tenant,
            queue: 'learning',
            maxAttempts: attempts,
            payload: { taskId: f.taskId },
          },
        });
      });
      return {
        taskId: f.taskId,
        job: {
          id: jobId,
          data: { tenantId: tenant, taskId: f.taskId },
          opts: { attempts },
          attemptsMade: 0,
        } as Job<{ tenantId: string; taskId: string }>,
      };
    }
    const retry = await queued(2);
    responses.push({ message: 'Invalid action', action: 'publish' });
    await expect(run(retry.job)).rejects.toThrow('valid response');
    let task = await withTenant(tenant, (db) =>
      db.learningTask.findUniqueOrThrow({ where: { id: retry.taskId } }),
    );
    expect(task.status).toBe('queued');
    expect(task.progress).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: 'understand', status: 'working' })]),
    );
    retry.job.attemptsMade = 1;
    responses.push({ message: 'Tell me what you would like to learn.', action: 'respond' });
    await run(retry.job);
    task = await withTenant(tenant, (db) =>
      db.learningTask.findUniqueOrThrow({ where: { id: retry.taskId } }),
    );
    expect(task.status).toBe('completed');
    expect((task.progress as { status: string }[]).every((s) => s.status === 'complete')).toBe(
      true,
    );
    const terminal = await queued(1);
    responses.push({ message: 'Invalid action', action: 'publish' });
    await expect(run(terminal.job)).rejects.toThrow('valid response');
    task = await withTenant(tenant, (db) =>
      db.learningTask.findUniqueOrThrow({ where: { id: terminal.taskId } }),
    );
    expect(task.status).toBe('failed');
    expect(task.progress).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: 'understand', status: 'failed' })]),
    );
  });
  it('finishes tool progress when a durable action checkpoint is replayed', async () => {
    const f = await fixture();
    responses.push(
      { message: 'Prepare a lesson.', action: 'create_lesson', topic: 'Checkpoint study' },
      lessonTemplate({
        topic: 'Checkpoint study',
        audience: 'Learners aged 13+',
        durationMinutes: 30,
        instructions: '',
        sourceIds: [],
      }),
    );
    const cache = new Map<string, unknown>();
    let interrupted = false;
    const checkpoint = async <T>(id: string, execute: () => Promise<T>): Promise<T> => {
      if (cache.has(id)) return cache.get(id) as T;
      const result = await execute();
      cache.set(id, result);
      if (id === 'action-create_lesson' && !interrupted) {
        interrupted = true;
        throw new Error('Synthetic checkpoint replay');
      }
      return result;
    };
    await expect(
      processLearningAgent(tenant, f.taskId, owner, f.input, config(), checkpoint),
    ).rejects.toThrow('Synthetic checkpoint replay');
    const result = await processLearningAgent(
      tenant,
      f.taskId,
      owner,
      f.input,
      config(),
      checkpoint,
    );
    planIds.push(result.planId as string);
    const task = await withTenant(tenant, (db) =>
      db.learningTask.findUniqueOrThrow({ where: { id: f.taskId } }),
    );
    expect(task.status).toBe('completed');
    expect((task.progress as { status: string }[]).every((s) => s.status === 'complete')).toBe(
      true,
    );
  });
  it('preserves conversations when AI is unavailable', async () => {
    const f = await fixture();
    await expect(processLearningAgent(tenant, f.taskId, owner, f.input, {})).rejects.toThrow(
      'conversation and attachments are saved',
    );
    const thread = await withTenant(tenant, (db) =>
      db.learningThread.findUniqueOrThrow({ where: { id: f.input.threadId } }),
    );
    expect(thread.messages as unknown[]).toHaveLength(1);
  });
  it.each([false, true])(
    'creates complete model lessons even when the planner omits annotations (explicit=%s)',
    async (explicit) => {
      const f = await fixture();
      const modelId = randomUUID();
      const input = {
        ...f.input,
        context: {
          ...f.input.context,
          privateModelId: modelId,
          model: {
            id: modelId,
            title: 'Synthetic sphere',
            metadata: { parts: [{ key: 'mesh-0', name: 'Sphere' }] },
          },
        },
      };
      responses.push(
        {
          message: 'Prepare both drafts.',
          action: 'create_lesson',
          ...(explicit ? { additionalActions: ['label_model'] } : {}),
          topic: 'Sphere study',
        },
        {
          title: 'Sphere study',
          summary: 'Explore the curved surface of a synthetic sphere.',
          audience: 'Learners aged 13+',
          durationMinutes: 30,
          objectives: ['Describe a curved surface'],
          sections: ['introduction', 'explanation', 'exploration', 'quiz', 'recap'].map(
            (kind, i) => ({
              id: `section_${i}`,
              kind,
              title: `Sphere section ${i + 1}`,
              minutes: 5,
              body: 'Explore the sphere and observe its continuous curved surface.',
              notes: '',
              sourceRefs: [],
              ...(kind === 'quiz'
                ? {
                    quiz: {
                      prompt: 'Which surface describes a sphere?',
                      choices: [
                        { id: 'curved', label: 'Curved' },
                        { id: 'flat', label: 'Flat faces' },
                      ],
                      correctIds: ['curved'],
                      explanation: 'A sphere has a curved surface.',
                    },
                  }
                : {}),
            }),
          ),
        },
        {
          labels: [
            {
              id: 'surface',
              meshKey: 'mesh-0',
              label: 'Sphere surface',
              explanation: 'A curved surface for synthetic study.',
              position: [0, 0, 0],
              confidence: 'named',
            },
          ],
        },
      );
      const result = await processLearningAgent(tenant, f.taskId, owner, input, config());
      planIds.push(result.planId as string);
      expect(result.planId).toBeTruthy();
      expect(result.labels).toHaveLength(1);
      expect(result.modelId).toBe(modelId);
      const plan = await withTenant(tenant, (db) =>
        db.lessonPlan.findUniqueOrThrow({ where: { id: result.planId as string } }),
      );
      expect(
        await withTenant(tenant, (db) =>
          db.lessonPlanRelease.count({ where: { planId: plan.id } }),
        ),
      ).toBe(0);
      expect(
        (
          plan.definition as unknown as {
            sections: { activity?: { targets: { id: string; placement?: string }[] } }[];
          }
        ).sections.some((s) =>
          s.activity?.targets.some((t) => t.id === 'surface' && t.placement === 'suggested'),
        ),
      ).toBe(true);
    },
  );
  it('fences a cancelled run before a specialist can create an artifact', async () => {
    const f = await fixture();
    responses.push({
      message: 'Create a draft.',
      action: 'create_lesson',
      topic: 'Cancelled synthetic lesson',
    });
    await expect(
      processLearningAgent(tenant, f.taskId, owner, f.input, config(), async (id, execute) => {
        const value = await execute();
        if (id === 'coordinator')
          await withTenant(tenant, (db) =>
            db.learningTask.update({ where: { id: f.taskId }, data: { status: 'cancelled' } }),
          );
        return value;
      }),
    ).rejects.toThrow('Generation stopped');
    const task = await withTenant(tenant, (db) =>
      db.learningTask.findUniqueOrThrow({ where: { id: f.taskId } }),
    );
    expect(task.status).toBe('cancelled');
    expect(task.result).toBeNull();
  });
});
