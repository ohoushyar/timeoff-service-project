import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { buildTestApp, signToken } from '../helpers/app.js';
import { setupTestDb, teardownTestDb, getTestDatabaseUrl } from '../helpers/db.js';
import type { FastifyInstance } from 'fastify';
import type { PrismaClient } from '@prisma/client';

describe('routes/v1/health', () => {
  let app: FastifyInstance;
  let prisma: PrismaClient;

  beforeAll(async () => {
    prisma = await setupTestDb();
    app = await buildTestApp({ DATABASE_URL: getTestDatabaseUrl() }, prisma);
  });

  afterAll(async () => {
    await app.close();
    await teardownTestDb(prisma);
  });

  it('/health/live always 200', async () => {
    const res = await app.inject({ method: 'GET', url: '/health/live' });
    expect(res.statusCode).toBe(200);
  });
});

describe('routes/v1/sync auth', () => {
  let app: FastifyInstance;
  let prisma: PrismaClient;

  beforeAll(async () => {
    prisma = await setupTestDb();
    app = await buildTestApp({ DATABASE_URL: getTestDatabaseUrl() }, prisma);
  });

  afterAll(async () => {
    await app.close();
    await teardownTestDb(prisma);
  });

  it('POST sync requires system_admin', async () => {
    const token = signToken(app, { sub: 'emp', roles: ['employee'], employeeId: 'x' });
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/sync/time-off',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(403);
  });
});

describe('app bootstrap', () => {
  it('builds app with plugins', async () => {
    const prisma = await setupTestDb();
    const app = await buildTestApp({ DATABASE_URL: getTestDatabaseUrl() }, prisma);
    expect(app.hasDecorator('prisma')).toBe(true);
    expect(app.hasDecorator('config')).toBe(true);
    await app.close();
    await teardownTestDb(prisma);
  });
});
