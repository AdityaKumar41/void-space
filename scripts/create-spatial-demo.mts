/** Add one usable experience through the normal API; never resets existing data. */
import { loadRootEnv } from '../packages/db/src/env';
loadRootEnv({ override: false });
const { loadEnv } = await import('../apps/api/src/env');
const { buildApp } = await import('../apps/api/src/app');
const app = await buildApp(loadEnv({ ...process.env, NODE_ENV: 'test', LOG_LEVEL: 'error' }));
const title = 'Cordless drill — component exploration';
try {
  const login = await app.inject({
    method: 'POST',
    url: '/api/v1/auth/login',
    payload: { email: 'creator@aurora.dev', password: 'VoidSpace!2026' },
  });
  if (login.statusCode !== 200) throw new Error('Demo workspace login failed');
  const cookies = login.headers['set-cookie'];
  const cookie = (Array.isArray(cookies) ? cookies : [cookies ?? ''])
    .map((x) => x.split(';')[0])
    .join('; ');
  const call = async (method: 'GET' | 'POST', path: string, payload?: unknown) => {
    const response = await app.inject({
      method,
      url: '/api/v1' + path,
      headers: { cookie },
      ...(payload ? { payload: payload as object } : {}),
    });
    if (response.statusCode >= 400)
      throw new Error(`${method} ${path}: ${response.statusCode} ${response.body}`);
    return response.json();
  };
  const existing = (await call('GET', '/simulations?includeDrafts=true')).scenarios.find(
    (s: { title: string }) => s.title === title,
  );
  if (existing) {
    console.log(
      JSON.stringify({
        id: existing.id,
        status: existing.status,
        url: 'http://localhost:3000/console/simulations',
      }),
    );
  } else {
    const asset = (await call('GET', '/lessons/assets')).assets.find(
      (a: { name: string }) => a.name === 'Cordless Impact Drill',
    );
    if (!asset?.media?.cid) throw new Error('Reviewed Cordless Impact Drill model is required');
    const gateway = process.env.IPFS_GATEWAY_URL ?? 'http://127.0.0.1:8080';
    const response = await fetch(
      `${gateway.replace(/\/$/, '').replace(/\/ipfs$/, '')}/ipfs/${asset.media.cid}`,
    );
    if (!response.ok) throw new Error('Cannot load the reviewed source model');
    const bytes = Buffer.from(await response.arrayBuffer());
    const json = JSON.parse(bytes.subarray(20, 20 + bytes.readUInt32LE(12)).toString());
    if (json.asset.generator !== 'void-space/glb-shapes' || json.nodes?.[0]?.name !== 'drill')
      throw new Error(
        'Source is not the known component-layout drill; place anchors visually instead',
      );
    const positions = json.meshes.flatMap(
      (m: { primitives: Array<{ attributes: { POSITION: number } }> }) =>
        m.primitives.map((p) => json.accessors[p.attributes.POSITION]),
    );
    const min = [0, 1, 2].map((i) =>
      Math.min(...positions.map((a: { min: number[] }) => a.min[i])),
    );
    const max = [0, 1, 2].map((i) =>
      Math.max(...positions.map((a: { max: number[] }) => a.max[i])),
    );
    const span = Math.max(...max.map((v: number, i: number) => v - min[i]));
    const anchor = (point: number[]) => point.map((v, i) => (v - (min[i] + max[i]) / 2) / span);
    const base = {
      weight: 100,
      explanation:
        'Explore the reviewed component layout. This is a model exploration exercise, not equipment operation training.',
    };
    const result = await call('POST', '/simulations', {
      title,
      description:
        'Explore a reviewed 3D drill: locate its battery and chuck, separate the component meshes, isolate the battery and restore the model. Finish by responding to a source discrepancy. This teaches component layout and review judgement; it does not simulate electrical or mechanical behaviour.',
      experience: {
        schemaVersion: 1,
        assetId: asset.id,
        passingScore: 80,
        hotspots: [
          {
            id: 'battery',
            label: 'Battery pack',
            meshKey: 'mesh-2',
            position: anchor([-0.042, -0.02, 0.0375]),
          },
          {
            id: 'chuck',
            label: 'Chuck and bit',
            meshKey: 'mesh-3',
            position: anchor([0.1, 0.14, 0.03]),
          },
          {
            id: 'housing',
            label: 'Motor housing',
            meshKey: 'mesh-0',
            position: anchor([-0.1, 0.14, 0.043]),
          },
        ],
        steps: [
          {
            ...base,
            id: 'battery',
            kind: 'identify',
            targetId: 'battery',
            title: 'Find the battery pack',
            instruction:
              'Orbit the model and select the marker on the battery at the bottom of the grip.',
          },
          {
            ...base,
            id: 'chuck',
            kind: 'identify',
            targetId: 'chuck',
            title: 'Find the chuck and bit',
            instruction: 'Select the marker on the front assembly that holds the bit.',
          },
          {
            ...base,
            id: 'separate',
            kind: 'operate',
            operation: 'explode',
            title: 'Explore the component layout',
            instruction:
              'Use Explode model to separate the component meshes. Orbit to inspect their arrangement.',
          },
          {
            ...base,
            id: 'isolate',
            kind: 'operate',
            operation: 'isolate',
            targetId: 'battery',
            title: 'Inspect the battery alone',
            instruction:
              'Select the battery marker, then use Isolate selected to hide the other components.',
          },
          {
            ...base,
            id: 'restore',
            kind: 'operate',
            operation: 'assemble',
            title: 'Restore the assembled view',
            instruction:
              'Use Reassemble / show all to return every component to its original position.',
          },
          {
            ...base,
            id: 'review',
            kind: 'decision',
            title: 'Resolve a source discrepancy',
            instruction:
              'A component in the source description does not match the reviewed model. What should happen before this material is reused?',
            correctChoiceId: 'request',
            onIncorrect: 'end',
            choices: [
              {
                id: 'request',
                label: 'Request a review of the source material',
                feedback:
                  'The discrepancy is flagged for an author to resolve before the material is reused.',
              },
              {
                id: 'ignore',
                label: 'Ignore the discrepancy and reuse it',
                feedback:
                  'The mismatch remains unresolved. The assessment ends here; review the source before retrying.',
              },
            ],
          },
        ],
      },
    });
    await call('POST', `/simulations/${result.scenario.id}/publish`, {});
    console.log(
      JSON.stringify({
        id: result.scenario.id,
        status: 'published',
        url: 'http://localhost:3000/console/simulations',
      }),
    );
  }
} finally {
  await app.close();
  const { disconnectAll } = await import('../packages/db/src/client');
  await disconnectAll();
}
