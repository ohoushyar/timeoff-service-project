import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { buildTestApp } from '../helpers/app.js';
import { setupTestDb, teardownTestDb, getTestDatabaseUrl } from '../helpers/db.js';
import type { TestAppContext } from '../helpers/app.js';
import type { PrismaClient } from '@prisma/client';

describe('IT-1.1 GET /health/live', () => {
  let ctx: TestAppContext;

  beforeAll(async () => {
    const prisma = await setupTestDb();
    ctx = await buildTestApp({ DATABASE_URL: getTestDatabaseUrl() }, prisma);
  });

  afterAll(async () => {
    await ctx.app.close();
  });

  it('returns 200 without auth with process-alive payload', async () => {
    const res = await ctx.agent.get('/health/live');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'ok' });
  });
});

describe('IT-1.2 GET /health/ready', () => {
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

  it('returns 200 when DB is reachable', async () => {
    const res = await ctx.agent.get('/health/ready');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'ready' });
  });

  it('returns 503 when DB is unavailable', async () => {
    const originalQuery = prisma.$queryRaw.bind(prisma);
    prisma.$queryRaw = (() => {
      throw new Error('database unavailable');
    }) as typeof prisma.$queryRaw;

    const res = await ctx.agent.get('/health/ready');
    expect(res.status).toBe(503);
    expect(res.body).toEqual({ status: 'not ready' });

    prisma.$queryRaw = originalQuery;
  });
});
