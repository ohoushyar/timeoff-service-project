import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { buildTestApp, signToken } from '../helpers/app.js';
import { setupTestDb, teardownTestDb, getTestDatabaseUrl } from '../helpers/db.js';
import type { TestAppContext } from '../helpers/app.js';
import type { PrismaClient } from '@prisma/client';

describe('routes/v1/health', () => {
  let ctx: TestAppContext;
  let prisma: PrismaClient;

  beforeAll(async () => {
    prisma = await setupTestDb();
    ctx = await buildTestApp({ DATABASE_URL: getTestDatabaseUrl() }, prisma);
  });

  afterAll(async () => {
    await ctx.app.close();
    await teardownTestDb(prisma);
  });

  it('/health/live always 200', async () => {
    const res = await ctx.agent.get('/health/live');
    expect(res.status).toBe(200);
  });
});

describe('routes/v1/sync auth', () => {
  let ctx: TestAppContext;
  let prisma: PrismaClient;

  beforeAll(async () => {
    prisma = await setupTestDb();
    ctx = await buildTestApp({ DATABASE_URL: getTestDatabaseUrl() }, prisma);
  });

  afterAll(async () => {
    await ctx.app.close();
    await teardownTestDb(prisma);
  });

  it('POST sync requires system_admin', async () => {
    const token = signToken(ctx.jwt, { sub: 'emp', roles: ['employee'], employeeId: 'x' });
    const res = await ctx.agent
      .post('/api/v1/sync/time-off')
      .set('authorization', `Bearer ${token}`);
    expect(res.status).toBe(403);
  });
});

describe('app bootstrap', () => {
  it('builds Nest app with core providers', async () => {
    const prisma = await setupTestDb();
    const ctx = await buildTestApp({ DATABASE_URL: getTestDatabaseUrl() }, prisma);
    expect(ctx.prisma).toBe(prisma);
    expect(ctx.jwt).toBeDefined();
    await ctx.app.close();
    await teardownTestDb(prisma);
  });

  it('serves OpenAPI JSON at /docs/json', async () => {
    const prisma = await setupTestDb();
    const ctx = await buildTestApp({ DATABASE_URL: getTestDatabaseUrl() }, prisma);
    const res = await ctx.agent.get('/docs/json');
    expect(res.status).toBe(200);
    expect(res.body.openapi).toBe('3.0.3');
    expect(res.body.paths['/health/live']).toBeDefined();
    await ctx.app.close();
    await teardownTestDb(prisma);
  });
});
