import { z } from 'zod';

export const registerIoTDeviceSchema = z.object({
  label: z.string().trim().min(3).max(160),
  metadata: z.record(z.unknown()).optional(),
});
export const createDigitalTwinSchema = z.object({
  deviceId: z.string().uuid(),
  assetId: z.string().uuid().optional(),
  label: z.string().trim().min(3).max(160),
  state: z.record(z.unknown()).default({}),
});
export const deviceTelemetrySchema = z.object({
  payload: z.record(z.unknown()),
  eventAt: z.string().datetime().optional(),
});
