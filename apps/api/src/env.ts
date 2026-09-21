/**
 * Environment validation for the API (SRS §9.4).
 *
 * The process refuses to start on a missing or malformed configuration, so a
 * mis-set DATABASE_URL can never silently disable tenant isolation.
 */
import { z } from 'zod';

const booleanish = z
  .string()
  .optional()
  .transform((value) => value === 'true' || value === '1');

export const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
  API_PORT: z.coerce.number().int().min(1).max(65535).default(4000),
  /** Comma-separated allow-list for browser calls (the edge proxy in front of us). */
  CORS_ORIGINS: z
    .string()
    .default('https://localhost,http://localhost:3000,https://localhost:3000')
    .transform((value) =>
      value
        .split(',')
        .map((origin) => origin.trim())
        .filter((origin) => origin.length > 0),
    ),

  // --- data tier -----------------------------------------------------------
  DATABASE_URL: z.string().url(),
  PLATFORM_DATABASE_URL: z.string().url(),
  REDIS_URL: z.string().url(),
  IPFS_API_URL: z.string().url(),
  IPFS_GATEWAY_URL: z.string().url(),
  ANVIL_RPC_URL: z.string().url(),

  // --- auth (FR-2.3) -------------------------------------------------------
  JWT_ACCESS_SECRET: z.string().min(16),
  JWT_REFRESH_SECRET: z.string().min(16),
  JWT_ACCESS_TTL: z.string().default('15m'),
  JWT_REFRESH_TTL: z.string().default('7d'),

  // --- optional integrations (absent => graceful degradation, NFR-REL.1) ---
  ANTHROPIC_API_KEY: z.string().optional(),
  GOOGLE_CLIENT_ID: z.string().optional(),
  GOOGLE_CLIENT_SECRET: z.string().optional(),
  GOOGLE_REDIRECT_URI: z.string().url().optional(),
  SIWE_ENABLED: booleanish,

  // --- contract address published by dev-up (§9.3) -------------------------
  CONTRACT_ADDRESS: z
    .string()
    .regex(/^0x[a-fA-F0-9]{40}$/)
    .optional()
    .or(z.literal('').transform(() => undefined)),
  CONTRACT_STATE_PATH: z.string().optional(),
});

export type ApiEnv = z.infer<typeof envSchema>;

export function loadEnv(source: NodeJS.ProcessEnv = process.env): ApiEnv {
  const parsed = envSchema.safeParse(source);
  if (!parsed.success) {
    const details = parsed.error.issues
      .map((issue) => `  • ${issue.path.join('.') || '(root)'}: ${issue.message}`)
      .join('\n');
    throw new Error(
      `[api] invalid environment configuration:\n${details}\n` +
        'Check your .env against .env.example (SRS §9.4).',
    );
  }
  return parsed.data;
}
