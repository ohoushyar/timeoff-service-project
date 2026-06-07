import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import {
  setupIntegrationContext,
  teardownIntegrationContext,
  authHeaders,
  assertJsonApi,
  type IntegrationContext,
} from '../helpers/integration.js';

describe('IT-1.3 GET /api/v1/employees/{id}', () => {
  let ctx: IntegrationContext;

  beforeAll(async () => {
    ctx = await setupIntegrationContext();
  });

  afterAll(async () => {
    await teardownIntegrationContext(ctx);
  });

  it('returns 200 for self with employees type and no PII attributes', async () => {
    const token = ctx.token('employee', { sub: 'alice', employeeId: ctx.aliceId });
    const res = await ctx.app.inject({
      method: 'GET',
      url: `/api/v1/employees/${ctx.aliceId}`,
      headers: authHeaders(token, ''),
    });
    expect(res.statusCode).toBe(200);
    assertJsonApi(res);
    const body = res.json() as { data: { type: string; attributes: Record<string, unknown> } };
    expect(body.data.type).toBe('employees');
    expect(body.data.attributes).not.toHaveProperty('name');
    expect(body.data.attributes).not.toHaveProperty('phone');
    expect(body.data.attributes).not.toHaveProperty('hireDate');
    expect(body.data.attributes).not.toHaveProperty('email');
  });

  it('returns 200 for manager viewing direct report', async () => {
    const token = ctx.token('manager', { sub: 'bob', employeeId: ctx.bobId });
    const res = await ctx.app.inject({
      method: 'GET',
      url: `/api/v1/employees/${ctx.aliceId}`,
      headers: authHeaders(token, ''),
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().data.id).toBe(ctx.aliceId);
  });

  it('returns 403 for unrelated employee', async () => {
    const token = ctx.token('employee', { sub: 'alice', employeeId: ctx.aliceId });
    const res = await ctx.app.inject({
      method: 'GET',
      url: `/api/v1/employees/${ctx.bobId}`,
      headers: authHeaders(token, ''),
    });
    expect(res.statusCode).toBe(403);
  });

  it('returns 404 when mapping is missing', async () => {
    const token = ctx.token('hr_admin', { sub: 'carol', employeeId: ctx.carolId });
    const res = await ctx.app.inject({
      method: 'GET',
      url: '/api/v1/employees/00000000-0000-4000-8000-000000000099',
      headers: authHeaders(token, ''),
    });
    expect(res.statusCode).toBe(404);
  });
});
