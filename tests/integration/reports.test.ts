import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import {
  setupIntegrationContext,
  teardownIntegrationContext,
  authHeaders,
  leaveRequestPayload,
  type IntegrationContext,
} from '../helpers/integration.js';

async function approveAliceRequest(
  ctx: IntegrationContext,
  dates: { start: string; end: string },
): Promise<void> {
  const employeeToken = ctx.token('employee', { sub: 'alice', employeeId: ctx.aliceId });
  const createRes = await ctx.app.inject({
    method: 'POST',
    url: '/api/v1/leave-requests',
    headers: authHeaders(employeeToken),
    payload: leaveRequestPayload(ctx.aliceId, ctx.leaveTypeId, {
      startDate: dates.start,
      endDate: dates.end,
      submit: true,
      dimensions: { locationId: 'US-NY' },
    }),
  });
  expect(createRes.statusCode).toBe(201);
  const requestId = createRes.json().data.id;
  const managerToken = ctx.token('manager', { sub: 'bob', employeeId: ctx.bobId });
  await ctx.app.inject({
    method: 'POST',
    url: `/api/v1/leave-requests/${requestId}/approve`,
    headers: authHeaders(managerToken),
    payload: { data: { type: 'approvals', attributes: {} } },
  });
}

describe('IT-2.3 GET /api/v1/reports/leave-usage', () => {
  let ctx: IntegrationContext;

  beforeAll(async () => {
    ctx = await setupIntegrationContext();
    await approveAliceRequest(ctx, { start: '2029-03-11', end: '2029-03-13' });
  });

  afterAll(async () => {
    await teardownIntegrationContext(ctx);
  });

  it('returns 200 for manager with meta.summary aggregates', async () => {
    const token = ctx.token('manager', { sub: 'bob', employeeId: ctx.bobId });
    const res = await ctx.app.inject({
      method: 'GET',
      url: '/api/v1/reports/leave-usage?filter[startDate]=2029-01-01&filter[endDate]=2029-12-31',
      headers: authHeaders(token, ''),
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.meta.summary.requestCount).toBeGreaterThan(0);
    expect(body.meta.summary.totalDays).toBeGreaterThan(0);
  });

  it('returns 403 for employee', async () => {
    const token = ctx.token('employee', { sub: 'alice', employeeId: ctx.aliceId });
    const res = await ctx.app.inject({
      method: 'GET',
      url: '/api/v1/reports/leave-usage',
      headers: authHeaders(token, ''),
    });
    expect(res.statusCode).toBe(403);
  });
});

describe('IT-2.4 GET /api/v1/reports/team-calendar', () => {
  let ctx: IntegrationContext;

  beforeAll(async () => {
    ctx = await setupIntegrationContext();
    const token = ctx.token('employee', { sub: 'alice', employeeId: ctx.aliceId });
    const createRes = await ctx.app.inject({
      method: 'POST',
      url: '/api/v1/leave-requests',
      headers: authHeaders(token),
      payload: leaveRequestPayload(ctx.aliceId, ctx.leaveTypeId, {
        startDate: '2029-04-03',
        endDate: '2029-04-04',
        submit: true,
        dimensions: { locationId: 'US-NY' },
      }),
    });
    expect(createRes.statusCode).toBe(201);
  });

  afterAll(async () => {
    await teardownIntegrationContext(ctx);
  });

  it('returns 200 manager team view with date-range filter', async () => {
    const token = ctx.token('manager', { sub: 'bob', employeeId: ctx.bobId });
    const res = await ctx.app.inject({
      method: 'GET',
      url: '/api/v1/reports/team-calendar?filter[startDate]=2029-04-01&filter[endDate]=2029-04-30',
      headers: authHeaders(token, ''),
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().data.length).toBeGreaterThan(0);
    expect(res.json().data[0].relationships.employee.data.id).toBe(ctx.aliceId);
  });
});

describe('IT-2.5 GET /api/v1/reports/audit', () => {
  let ctx: IntegrationContext;

  beforeAll(async () => {
    ctx = await setupIntegrationContext();
  });

  afterAll(async () => {
    await teardownIntegrationContext(ctx);
  });

  it('returns 200 for hr_admin with no email in rows', async () => {
    const token = ctx.token('hr_admin', { sub: 'carol', employeeId: ctx.carolId });
    const res = await ctx.app.inject({
      method: 'GET',
      url: '/api/v1/reports/audit',
      headers: authHeaders(token, ''),
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().data[0].type).toBe('audit-logs');
    const serialized = JSON.stringify(res.json());
    expect(serialized).not.toMatch(/@example\.com/);
  });

  it('returns 403 for manager', async () => {
    const token = ctx.token('manager', { sub: 'bob', employeeId: ctx.bobId });
    const res = await ctx.app.inject({
      method: 'GET',
      url: '/api/v1/reports/audit',
      headers: authHeaders(token, ''),
    });
    expect(res.statusCode).toBe(403);
  });
});
