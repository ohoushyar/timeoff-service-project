import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import {
  setupIntegrationContext,
  teardownIntegrationContext,
  authHeaders,
  assertJsonApi,
  type IntegrationContext,
} from '../helpers/integration.js';

describe('IT-2.1 GET /api/v1/sync-runs', () => {
  let ctx: IntegrationContext;

  beforeAll(async () => {
    ctx = await setupIntegrationContext();
  });

  afterAll(async () => {
    await teardownIntegrationContext(ctx);
  });

  it('returns 200 for hr_admin with paginated history ordered by startedAt desc', async () => {
    const token = ctx.token('hr_admin', { sub: 'carol', employeeId: ctx.carolId });
    const res = await ctx.app.inject({
      method: 'GET',
      url: '/api/v1/sync-runs?page[number]=1&page[size]=25',
      headers: authHeaders(token, ''),
    });
    expect(res.statusCode).toBe(200);
    assertJsonApi(res);
    const body = res.json();
    expect(body.meta.totalCount).toBeGreaterThan(0);
    expect(body.data[0].type).toBe('sync-runs');
    if (body.data.length >= 2) {
      const a = new Date(body.data[0].attributes.startedAt).getTime();
      const b = new Date(body.data[1].attributes.startedAt).getTime();
      expect(a).toBeGreaterThanOrEqual(b);
    }
  });

  it('returns 403 for employee', async () => {
    const token = ctx.token('employee', { sub: 'alice', employeeId: ctx.aliceId });
    const res = await ctx.app.inject({
      method: 'GET',
      url: '/api/v1/sync-runs',
      headers: authHeaders(token, ''),
    });
    expect(res.statusCode).toBe(403);
  });
});

describe('IT-2.2 GET /api/v1/sync-runs/{id}', () => {
  let ctx: IntegrationContext;

  beforeAll(async () => {
    ctx = await setupIntegrationContext();
  });

  afterAll(async () => {
    await teardownIntegrationContext(ctx);
  });

  it('returns 200 with adjustment counts and correlation id', async () => {
    const run = await ctx.prisma.syncRun.findFirstOrThrow({ orderBy: { startedAt: 'desc' } });
    const token = ctx.token('hr_admin', { sub: 'carol', employeeId: ctx.carolId });
    const res = await ctx.app.inject({
      method: 'GET',
      url: `/api/v1/sync-runs/${run.id}`,
      headers: authHeaders(token, ''),
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().data.attributes.correlationId).toBeTruthy();
    expect(res.json().data.attributes.adjustmentCount).toBeDefined();
  });

  it('returns 404 for unknown run', async () => {
    const token = ctx.token('hr_admin', { sub: 'carol', employeeId: ctx.carolId });
    const res = await ctx.app.inject({
      method: 'GET',
      url: '/api/v1/sync-runs/00000000-0000-0000-0000-000000000000',
      headers: authHeaders(token, ''),
    });
    expect(res.statusCode).toBe(404);
  });
});
