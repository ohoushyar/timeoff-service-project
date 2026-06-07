import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import {
  setupIntegrationContext,
  teardownIntegrationContext,
  authHeaders,
  assertJsonApi,
  type IntegrationContext,
} from '../helpers/integration.js';

describe('IT-1.7 GET /api/v1/policies', () => {
  let ctx: IntegrationContext;

  beforeAll(async () => {
    ctx = await setupIntegrationContext();
  });

  afterAll(async () => {
    await teardownIntegrationContext(ctx);
  });

  it('returns 200 for hr_admin with synced policy resources', async () => {
    const token = ctx.token('hr_admin', { sub: 'carol', employeeId: ctx.carolId });
    const res = await ctx.app.inject({
      method: 'GET',
      url: '/api/v1/policies',
      headers: authHeaders(token, ''),
    });
    expect(res.statusCode).toBe(200);
    assertJsonApi(res);
    expect(res.json().data.length).toBeGreaterThan(0);
    expect(res.json().data[0].type).toBe('policies');
  });

  it('returns 403 for employee', async () => {
    const token = ctx.token('employee', { sub: 'alice', employeeId: ctx.aliceId });
    const res = await ctx.app.inject({
      method: 'GET',
      url: '/api/v1/policies',
      headers: authHeaders(token, ''),
    });
    expect(res.statusCode).toBe(403);
  });
});
