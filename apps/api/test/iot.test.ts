import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { withTenant } from '@void-space/db';
import { cookieHeader, createTestApp, DEMO, DEMO_TENANT_IDS, login, type TestApp } from './helpers';
let context: TestApp;
let cookie: string;
let deviceId: string;
beforeAll(async () => {
  context = await createTestApp();
  cookie = cookieHeader((await login(context.app, DEMO.users.auroraCreator)).cookies, 'vs_access');
});
afterAll(async () => {
  if (deviceId)
    await withTenant(DEMO_TENANT_IDS.aurora, (db) =>
      db.ioTDevice.deleteMany({ where: { id: deviceId } }),
    );
  await context?.close();
});
describe('IoT telemetry history', () => {
  it('returns immutable device readings only to an authorized tenant operator', async () => {
    const register = await context.app.inject({
      method: 'POST',
      url: '/api/v1/iot/devices',
      headers: { cookie },
      payload: { label: 'History fixture sensor' },
    });
    expect(register.statusCode).toBe(201);
    const body = register.json() as { device: { id: string }; deviceSecret: string };
    deviceId = body.device.id;
    const ingest = await context.app.inject({
      method: 'POST',
      url: '/api/v1/iot/telemetry',
      headers: { cookie, 'x-device-id': deviceId, 'x-device-secret': body.deviceSecret },
      payload: { payload: { temperature: 24 } },
    });
    expect(ingest.statusCode).toBe(202);
    const history = await context.app.inject({
      method: 'GET',
      url: `/api/v1/iot/devices/${deviceId}/telemetry`,
      headers: { cookie },
    });
    expect(history.statusCode).toBe(200);
    expect(history.json()).toMatchObject({
      telemetry: [expect.objectContaining({ payload: { temperature: 24 } })],
    });
  });
});
