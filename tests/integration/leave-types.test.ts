import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import {
  setupIntegrationContext,
  teardownIntegrationContext,
  authHeaders,
  assertJsonApi,
  type IntegrationContext,
} from '../helpers/integration.js';

describe('IT-1.6 GET /api/v1/leave-types', () => {
  let ctx: IntegrationContext;

  beforeAll(async () => {
    ctx = await setupIntegrationContext();
  });

  afterAll(async () => {
    await teardownIntegrationContext(ctx);
  });

  it('returns 401 without JWT', async () => {
    const res = await ctx.inject({ method: 'GET', url: '/api/v1/leave-types' });
    expect(res.statusCode).toBe(401);
    expect(res.json().errors).toBeDefined();
    expect(res.json().jsonapi.version).toBe('1.1');
  });

  it('returns 200 authenticated with pagination meta and links', async () => {
    const token = ctx.token('employee', { sub: 'alice', employeeId: ctx.aliceId });
    const res = await ctx.inject({
      method: 'GET',
      url: '/api/v1/leave-types?page[number]=1&page[size]=10',
      headers: authHeaders(token, ''),
    });
    expect(res.statusCode).toBe(200);
    assertJsonApi(res);
    const body = res.json();
    expect(body.data.length).toBeGreaterThan(0);
    expect(body.meta).toMatchObject({ pageNumber: 1, totalCount: expect.any(Number) });
    expect(body.links).toBeDefined();
  });
});
