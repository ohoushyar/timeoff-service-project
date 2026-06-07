import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { buildTestApp } from '../helpers/app.js';
import { setupTestDb, teardownTestDb, getTestDatabaseUrl } from '../helpers/db.js';
import type { FastifyInstance } from 'fastify';
import type { PrismaClient } from '@prisma/client';

describe('IT-1.1 GET /health/live', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    const prisma = await setupTestDb();
    app = await buildTestApp({ DATABASE_URL: getTestDatabaseUrl() }, prisma);
  });

  afterAll(async () => {
    await app.close();
  });

  it('returns 200 without auth with process-alive payload', async () => {
    const res = await app.inject({ method: 'GET', url: '/health/live' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: 'ok' });
  });
});

describe('IT-1.2 GET /health/ready', () => {
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

  it('returns 200 when DB is reachable', async () => {
    const res = await app.inject({ method: 'GET', url: '/health/ready' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: 'ready' });
  });

  it('returns 503 when DB is unavailable', async () => {
    const originalQuery = prisma.$queryRaw.bind(prisma);
    prisma.$queryRaw = (() => {
      throw new Error('database unavailable');
    }) as typeof prisma.$queryRaw;

    const res = await app.inject({ method: 'GET', url: '/health/ready' });
    expect(res.statusCode).toBe(503);
    expect(res.json()).toEqual({ status: 'not ready' });

    prisma.$queryRaw = originalQuery;
  });
});
