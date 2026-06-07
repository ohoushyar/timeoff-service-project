import type { FastifyInstance } from 'fastify';
import { loadEnv, resetEnvCache } from '../../src/config/env.js';
import { buildApp } from '../../src/app.js';
import type { Role } from '../../src/auth/roles.js';

export function testEnv(overrides: Record<string, string> = {}) {
  resetEnvCache();
  return loadEnv({
    NODE_ENV: 'test',
    DATABASE_URL: overrides.DATABASE_URL ?? 'file:./prisma/test.db',
    JWT_SECRET: 'test-secret',
    JWT_ISSUER: 'timeoff-service',
    JWT_AUDIENCE: 'timeoff-api',
    WORKDAY_TENANT_HOSTNAME: overrides.WORKDAY_TENANT_HOSTNAME ?? '127.0.0.1:4001',
    HCM_MOCK_MODE: 'true',
    LOG_LEVEL: 'error',
    ...overrides,
  });
}

export async function buildTestApp(
  overrides?: Record<string, string>,
  prisma?: import('@prisma/client').PrismaClient,
): Promise<FastifyInstance> {
  const env = testEnv(overrides);
  return buildApp({ env, startJobs: false, prisma });
}

export function signToken(
  app: FastifyInstance,
  payload: { sub: string; roles: Role[]; employeeId?: string },
): string {
  return app.jwt.sign(payload);
}

export const JSON_API = 'application/vnd.api+json';
