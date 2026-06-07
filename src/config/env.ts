import { z } from 'zod';

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().default(3000),
  DATABASE_URL: z.string().min(1),
  JWT_SECRET: z.string().min(1),
  JWT_ISSUER: z.string().default('timeoff-service'),
  JWT_AUDIENCE: z.string().default('timeoff-api'),
  WORKDAY_TENANT_HOSTNAME: z.string().optional(),
  WORKDAY_CLIENT_ID: z.string().optional(),
  WORKDAY_CLIENT_SECRET: z.string().optional(),
  WORKDAY_REFRESH_TOKEN: z.string().optional(),
  HCM_MOCK_MODE: z
    .string()
    .optional()
    .transform((v) => v === 'true' || v === '1'),
  CRON_NIGHTLY_HCM_SYNC: z.string().default('0 2 * * *'),
  CRON_APPROVAL_REMINDER: z.string().default('0 9 * * 1-5'),
  CRON_HCM_APPROVAL_RETRY: z.string().default('0 * * * *'),
  HCM_APPROVAL_RETRY_WINDOW_HOURS: z.coerce.number().default(24),
  WORKDAY_SUBMITTED_ACTION_WID: z
    .string()
    .default('d9e4223e446c11de98360015c5e6daf6'),
  WORKDAY_PREFLIGHT_ENABLED: z
    .string()
    .optional()
    .transform((v) => v !== 'false' && v !== '0'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
});

export type Env = z.infer<typeof envSchema>;

let cachedEnv: Env | null = null;

export function loadEnv(overrides?: Record<string, string>): Env {
  const source = { ...process.env, ...overrides };
  const result = envSchema.safeParse(source);
  if (!result.success) {
    const messages = result.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`);
    throw new Error(`Invalid environment configuration:\n${messages.join('\n')}`);
  }
  cachedEnv = result.data;
  return result.data;
}

export function getEnv(): Env {
  if (!cachedEnv) {
    return loadEnv();
  }
  return cachedEnv;
}

export function resetEnvCache(): void {
  cachedEnv = null;
}
