import Redis from 'ioredis';
import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { sketchfabModelId, type SketchfabModel } from '@void-space/types';
import { z } from 'zod';
import type { FastifyInstance } from 'fastify';
import type { ApiEnv } from '../../env';
import { ForbiddenError, ValidationError, ConflictError } from '../../lib/errors';
import { parseBody } from '../../lib/http';
import { sketchfabArchiveToGlb } from './sketchfab-archive';
import { answerLessonQuestion } from '../learning/mentor';

const PATH = '/api/v1/tools/sketchfab';
const SESSION = 'void_sketchfab';
const STATE = 'void_sketchfab_state';
const tokenSchema = z.object({
  access_token: z.string().min(1).max(1500),
  expires_in: z.number().positive().max(31_536_000),
});
const sessionSchema = z.object({ actor: z.string(), token: z.string(), expires: z.number() });
const stateSchema = z.object({ actor: z.string(), expires: z.number(), nonce: z.string() });

/** Authenticated encryption; purpose separation prevents a state cookie becoming a token. */
export function sealedCookie(secret: string, purpose: string) {
  const key = createHash('sha256').update(`void-space:sketchfab:${purpose}:${secret}`).digest();
  return {
    seal(value: unknown) {
      const iv = randomBytes(12);
      const cipher = createCipheriv('aes-256-gcm', key, iv);
      const bytes = Buffer.concat([cipher.update(JSON.stringify(value)), cipher.final()]);
      return Buffer.concat([iv, cipher.getAuthTag(), bytes]).toString('base64url');
    },
    open(value: string | undefined): unknown {
      if (!value || value.length > 4096) return null;
      try {
        const bytes = Buffer.from(value, 'base64url');
        const decipher = createDecipheriv('aes-256-gcm', key, bytes.subarray(0, 12));
        decipher.setAuthTag(bytes.subarray(12, 28));
        return JSON.parse(
          Buffer.concat([decipher.update(bytes.subarray(28)), decipher.final()]).toString(),
        );
      } catch {
        return null;
      }
    },
  };
}

export function sketchfabModel(raw: unknown): SketchfabModel {
  const data = z
    .object({
      uid: z.string().regex(/^[a-f0-9]{32}$/),
      name: z.string().max(500),
      user: z
        .object({ displayName: z.string().optional(), username: z.string().optional() })
        .optional(),
      license: z.object({ label: z.string().optional() }).nullish(),
      isDownloadable: z.boolean().optional(),
      thumbnails: z
        .object({
          images: z.array(z.object({ url: z.string().url(), width: z.number().optional() })),
        })
        .optional(),
    })
    .parse(raw);
  const thumbnail =
    data.thumbnails?.images.find((image) => new URL(image.url).protocol === 'https:')?.url ?? null;
  return {
    uid: data.uid,
    name: data.name,
    author: data.user?.displayName ?? data.user?.username ?? 'Sketchfab author',
    license: data.license?.label ?? 'See model page for license',
    downloadable: data.isDownloadable === true,
    url: `https://sketchfab.com/3d-models/${data.uid}`,
    thumbnail,
  };
}

export interface SketchfabTransferStore {
  put(ticket: string, value: string): Promise<void>;
  take(ticket: string): Promise<string | null>;
}

export async function sketchfabRoutes(
  app: FastifyInstance,
  {
    env,
    fetchImpl = fetch,
    transferStore,
  }: { env: ApiEnv; fetchImpl?: typeof fetch; transferStore?: SketchfabTransferStore },
) {
  let redis: Redis | undefined;
  const store = transferStore ?? {
    async put(ticket: string, value: string) {
      redis ??= new Redis(env.REDIS_URL, {
        lazyConnect: true,
        maxRetriesPerRequest: 1,
        enableOfflineQueue: false,
      });
      if (redis.status === 'wait') await redis.connect();
      await redis.set(`sketchfab:transfer:${ticket}`, value, 'EX', 300);
    },
    async take(ticket: string) {
      redis ??= new Redis(env.REDIS_URL, {
        lazyConnect: true,
        maxRetriesPerRequest: 1,
        enableOfflineQueue: false,
      });
      if (redis.status === 'wait') await redis.connect();
      return redis.getdel(`sketchfab:transfer:${ticket}`);
    },
  };
  app.addHook('onClose', async () => {
    redis?.disconnect();
  });
  const transfers = sealedCookie(env.JWT_REFRESH_SECRET, 'model-transfer');
  const credentials = sealedCookie(env.JWT_REFRESH_SECRET, 'credentials');
  const states = sealedCookie(env.JWT_REFRESH_SECRET, 'state');
  const cookie = {
    httpOnly: true,
    sameSite: 'lax' as const,
    secure: env.COOKIE_SECURE,
    path: PATH,
  };
  const configured = Boolean(
    env.SKETCHFAB_CLIENT_ID &&
    env.SKETCHFAB_CLIENT_SECRET &&
    env.SKETCHFAB_REDIRECT_URI &&
    env.SKETCHFAB_WEB_ORIGIN,
  );
  for (const setting of [
    env.SKETCHFAB_WEB_ORIGIN,
    env.SKETCHFAB_REDIRECT_URI,
    env.SKETCHFAB_STUDIO_URL,
  ]) {
    if (!setting) continue;
    const url = new URL(setting);
    if (
      url.username ||
      url.password ||
      (url.protocol !== 'https:' &&
        !(url.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(url.hostname)))
    )
      throw new Error('Sketchfab URLs must use HTTPS or local development HTTP');
  }
  if (env.SKETCHFAB_WEB_ORIGIN) {
    const url = new URL(env.SKETCHFAB_WEB_ORIGIN);
    if (url.pathname !== '/' || url.search || url.hash || url.username || url.password)
      throw new Error('SKETCHFAB_WEB_ORIGIN must be an origin');
  }
  async function provider(path: string, token?: string) {
    const response = await fetchImpl(`https://api.sketchfab.com/v3/${path}`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
      redirect: 'error',
      signal: AbortSignal.timeout(15000),
    });
    if (!response.ok)
      throw new ConflictError(
        response.status === 429
          ? 'Sketchfab is busy. Try again later.'
          : 'Sketchfab could not provide this model. Check its visibility and your account permissions.',
        'SKETCHFAB_UNAVAILABLE',
      );
    // Metadata only; never proxy arbitrary provider text into AI or the interface.
    if (!response.body) throw new ConflictError('Sketchfab returned no model data');
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    try {
      while (true) {
        const part = await reader.read();
        if (part.done) break;
        size += part.value.byteLength;
        if (size > 2_000_000) throw new ValidationError('Sketchfab response is too large');
        chunks.push(part.value);
      }
    } finally {
      await reader.cancel();
    }
    return JSON.parse(Buffer.concat(chunks).toString()) as unknown;
  }
  function userToken(actor: string, value: string | undefined): string | undefined {
    const parsed = sessionSchema.safeParse(credentials.open(value));
    return parsed.success && parsed.data.actor === actor && parsed.data.expires > Date.now()
      ? parsed.data.token
      : undefined;
  }
  const auth = { preHandler: app.authenticate };
  app.addHook('onSend', async (_request, reply, payload) => {
    reply.header('Cache-Control', 'no-store');
    return payload;
  });
  app.get('/tools/sketchfab/status', auth, async (request, reply) => {
    reply.header('Cache-Control', 'no-store');
    const actor = `${request.principal!.tenantId}:${request.principal!.userId}`;
    return {
      configured,
      connected: Boolean(userToken(actor, request.cookies[SESSION])),
      studioImport: Boolean(env.SKETCHFAB_STUDIO_URL),
    };
  });
  app.post('/tools/sketchfab/connect', auth, async (request, reply) => {
    if (!configured)
      throw new ConflictError(
        'Sketchfab app registration is pending. Shared model links already work; OAuth downloads need administrator configuration.',
        'SKETCHFAB_NOT_CONFIGURED',
      );
    const state = states.seal({
      actor: `${request.principal!.tenantId}:${request.principal!.userId}`,
      expires: Date.now() + 600_000,
      nonce: randomBytes(32).toString('hex'),
    });
    reply.setCookie(STATE, state, { ...cookie, maxAge: 600 }).header('Cache-Control', 'no-store');
    const url = new URL('https://sketchfab.com/oauth2/authorize/');
    url.search = new URLSearchParams({
      response_type: 'code',
      client_id: env.SKETCHFAB_CLIENT_ID!,
      redirect_uri: env.SKETCHFAB_REDIRECT_URI!,
      state,
    }).toString();
    return { url: url.toString() };
  });
  app.get('/tools/sketchfab/callback', auth, async (request, reply) => {
    reply.header('Cache-Control', 'no-store').header('Referrer-Policy', 'no-referrer');
    const query = z
      .object({
        code: z.string().max(2000).optional(),
        state: z.string().max(4096).optional(),
        error: z.string().optional(),
      })
      .parse(request.query);
    const state = stateSchema.safeParse(states.open(query.state));
    const actor = `${request.principal!.tenantId}:${request.principal!.userId}`;
    reply.clearCookie(STATE, cookie);
    if (
      !configured ||
      !query.state ||
      query.state !== request.cookies[STATE] ||
      !state.success ||
      state.data.actor !== actor ||
      state.data.expires <= Date.now()
    )
      throw new ForbiddenError('Sketchfab connection expired. Start again from Models.');
    const destination = new URL('/console/models', env.SKETCHFAB_WEB_ORIGIN!);
    if (query.error || !query.code) {
      destination.searchParams.set('sketchfab', 'cancelled');
      return reply.redirect(destination.toString(), 302);
    }
    const response = await fetchImpl('https://sketchfab.com/oauth2/token/', {
      method: 'POST',
      redirect: 'error',
      signal: AbortSignal.timeout(15000),
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code: query.code,
        client_id: env.SKETCHFAB_CLIENT_ID!,
        client_secret: env.SKETCHFAB_CLIENT_SECRET!,
        redirect_uri: env.SKETCHFAB_REDIRECT_URI!,
      }),
    });
    if (!response.ok) {
      destination.searchParams.set('sketchfab', 'failed');
      return reply.redirect(destination.toString(), 302);
    }
    const token = tokenSchema.parse(await response.json());
    const ttl = Math.min(token.expires_in, 30 * 86400);
    reply.setCookie(
      SESSION,
      credentials.seal({ actor, token: token.access_token, expires: Date.now() + ttl * 1000 }),
      { ...cookie, maxAge: ttl },
    );
    return reply.redirect(destination.toString(), 302);
  });
  app.post('/tools/sketchfab/disconnect', auth, async (_request, reply) => {
    reply.clearCookie(SESSION, cookie);
    return { disconnected: true };
  });
  app.get('/tools/sketchfab/models/:uid', auth, async (request) => {
    const uid = sketchfabModelId((request.params as { uid: string }).uid);
    if (!uid) throw new ValidationError('Use a full Sketchfab model link or 32-character model ID');
    return { model: sketchfabModel(await provider(`models/${uid}`)) };
  });
  app.get('/tools/sketchfab/find', auth, async (request) => {
    const { q } = z.object({ q: z.string().trim().min(1).max(120) }).parse(request.query);
    const params = new URLSearchParams({ type: 'models', q, count: '12', downloadable: 'true' });
    const result = z
      .object({ results: z.array(z.unknown()).max(48) })
      .parse(await provider(`search?${params}`));
    return {
      models: result.results.flatMap((raw) => {
        try {
          return [sketchfabModel(raw)];
        } catch {
          return [];
        }
      }),
    };
  });
  app.post('/tools/sketchfab/mentor', auth, async (request) => {
    const { uid, question } = parseBody(
      z.object({
        uid: z.string().regex(/^[a-f0-9]{32}$/),
        question: z.string().trim().min(2).max(1500),
      }),
      request.body,
    );
    const model = sketchfabModel(await provider(`models/${uid}`));
    return answerLessonQuestion(
      {
        title: model.name,
        summary: `Model: ${model.name}. Author: ${model.author}. License: ${model.license}. This coach has metadata only and cannot see geometry or verify components.`,
        narration:
          'Orbit by dragging, zoom with the wheel, and use the viewer controls to inspect the model. View annotations supplied by its author. Editing requires a permitted download and import into Studio. Verify attribution and license before reuse.',
        outline: [
          'Compare the silhouette from multiple angles.',
          'Describe what you observe before asking for an explanation.',
          'For lesson-specific questions use the lesson mentor. This exploration does not change assessment results.',
        ],
      },
      question,
      env,
    );
  });
  async function downloadModel(uid: string, token: string): Promise<Buffer> {
    const model = sketchfabModel(await provider(`models/${uid}`, token));
    if (!model.downloadable)
      throw new ForbiddenError(
        'This author has not enabled downloads. You can still view the shared model.',
      );
    const archives = z
      .record(z.object({ url: z.string().url() }).passthrough())
      .parse(await provider(`models/${uid}/download`, token));
    const archive = archives.glb ?? archives.gltf;
    if (!archive) throw new ConflictError('No editable glTF download is available for this model');
    // Return neither signed URLs nor bearer credentials to the client. Fetch only the documented media host.
    const url = new URL(archive.url);
    if (
      url.protocol !== 'https:' ||
      url.username ||
      url.password ||
      url.port ||
      !['sketchfab-prod-media.s3.amazonaws.com', 'media.sketchfab.com'].includes(url.hostname)
    )
      throw new ValidationError('Sketchfab returned an unsupported download host');
    const response = await fetchImpl(url, {
      redirect: 'error',
      signal: AbortSignal.timeout(60000),
    });
    if (!response.ok || !response.body)
      throw new ConflictError('Sketchfab download expired. Try the download again.');
    const chunks: Uint8Array[] = [];
    let size = 0;
    const reader = response.body.getReader();
    try {
      while (true) {
        const next = await reader.read();
        if (next.done) break;
        size += next.value.byteLength;
        if (size > 100 * 1024 * 1024)
          throw new ValidationError('Model exceeds the 100 MB download limit');
        chunks.push(next.value);
      }
    } finally {
      await reader.cancel();
    }
    const bytes = Buffer.concat(chunks);
    let glb: Buffer;
    try {
      glb = sketchfabArchiveToGlb(bytes);
    } catch {
      throw new ValidationError(
        'The model archive could not be converted safely. Download it from the original model page and import its glTF files manually.',
      );
    }
    return glb;
  }
  // The downloading end user, not a site-wide API token, must authorize every download.
  app.get(
    '/tools/sketchfab/models/:uid/download',
    { preHandler: app.requirePermission('asset:upload-own') },
    async (request, reply) => {
      const uid = sketchfabModelId((request.params as { uid: string }).uid);
      if (!uid) throw new ValidationError('Invalid Sketchfab model');
      const token = userToken(
        `${request.principal!.tenantId}:${request.principal!.userId}`,
        request.cookies[SESSION],
      );
      if (!token)
        throw new ConflictError(
          'Connect your Sketchfab account in Models before downloading.',
          'SKETCHFAB_CONNECT_REQUIRED',
        );
      const glb = await downloadModel(uid, token);
      reply
        .header('Cache-Control', 'no-store')
        .header('Content-Disposition', `attachment; filename="sketchfab-${uid}.glb"`);
      return reply.type('model/gltf-binary').send(glb);
    },
  );
  app.post(
    '/tools/sketchfab/transfer',
    {
      preHandler: app.requirePermission('asset:upload-own'),
      config: { rateLimit: { max: 6, timeWindow: '1 minute' } },
    },
    async (request, reply) => {
      const { uid } = parseBody(
        z.object({ uid: z.string().regex(/^[a-f0-9]{32}$/) }),
        request.body,
      );
      if (!configured || !env.SKETCHFAB_STUDIO_URL)
        throw new ConflictError(
          'Studio import destination is not configured. Download the GLB and import it through File → Sketchfab Models.',
        );
      const target = new URL(env.SKETCHFAB_STUDIO_URL);
      if (
        target.protocol !== 'https:' &&
        !(target.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(target.hostname))
      )
        throw new ValidationError('Studio destination must use HTTPS');
      const actor = `${request.principal!.tenantId}:${request.principal!.userId}`;
      const token = userToken(actor, request.cookies[SESSION]);
      if (!token)
        throw new ConflictError(
          'Connect your Sketchfab account before importing into Studio.',
          'SKETCHFAB_CONNECT_REQUIRED',
        );
      const model = sketchfabModel(await provider(`models/${uid}`, token));
      if (!model.downloadable)
        throw new ForbiddenError('The author has not enabled downloads for this model.');
      const ticket = randomBytes(32).toString('hex');
      await store.put(ticket, transfers.seal({ uid, token, expires: Date.now() + 300_000 }));
      const base = new URL('/api/v1', env.SKETCHFAB_WEB_ORIGIN!);
      target.hash = new URLSearchParams({
        sketchfabTransfer: ticket,
        sketchfabApi: base.toString(),
        sketchfabCredit: `${model.name} by ${model.author} · ${model.license} · ${model.url}`,
      }).toString();
      reply.header('Referrer-Policy', 'no-referrer');
      return { url: target.toString() };
    },
  );
  // A short-lived, single-use capability authorizes exactly one model. No provider token reaches Studio.
  app.post(
    '/tools/sketchfab/receive',
    { config: { rateLimit: { max: 12, timeWindow: '1 minute' } } },
    async (request, reply) => {
      const { ticket } = parseBody(
        z.object({ ticket: z.string().regex(/^[a-f0-9]{64}$/) }),
        request.body,
      );
      const grant = z
        .object({ uid: z.string().regex(/^[a-f0-9]{32}$/), token: z.string(), expires: z.number() })
        .safeParse(transfers.open((await store.take(ticket)) ?? undefined));
      if (!grant.success || grant.data.expires <= Date.now())
        throw new ForbiddenError(
          'This model transfer expired or was already used. Start a new import from Void Space.',
        );
      const glb = await downloadModel(grant.data.uid, grant.data.token);
      return reply
        .type('model/gltf-binary')
        .header('Content-Disposition', 'attachment; filename="sketchfab-model.glb"')
        .send(glb);
    },
  );
}
