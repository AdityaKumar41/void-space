import { randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import { beforeAll, afterAll, describe, it, expect } from 'vitest';
import { withTenant, demoId } from '@void-space/db';
import { lessonTemplate } from '@void-space/types';
import type { Job } from 'bullmq';
import { createLearningProcessor } from '../src/processors/learning';
import { processLearningAgent } from '../src/learning/agent';
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
    requests.push(JSON.parse(body));
    res.setHeader('content-type', 'application/json');
    res.end(
      JSON.stringify({
        choices: [
          { message: { content: JSON.stringify(responses.shift()) }, finish_reason: 'stop' },
        ],
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
        expect.objectContaining({ id: 'tool', status: 'complete' }),
        expect.objectContaining({ id: 'write', status: 'complete' }),
        expect.objectContaining({ id: 'check', status: 'complete' }),
      ]),
    );
    expect((task.progress as { status: string }[]).some((s) => s.status === 'working')).toBe(false);
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
});
