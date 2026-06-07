import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import {
  setupIntegrationContext,
  teardownIntegrationContext,
  authHeaders,
  assertJsonApi,
  type IntegrationContext,
} from '../helpers/integration.js';

describe('IT-1.4 POST /api/v1/sync/time-off', () => {
  let ctx: IntegrationContext;

  beforeAll(async () => {
    ctx = await setupIntegrationContext();
  });

  afterAll(async () => {
    await teardownIntegrationContext(ctx);
  });

  it('allows system_admin and upserts snapshot metadata', async () => {
    const token = ctx.token('system_admin', { sub: 'admin' });
    const res = await ctx.app.inject({
      method: 'POST',
      url: '/api/v1/sync/time-off',
      headers: authHeaders(token, ''),
    });
    expect(res.statusCode).toBe(201);
    assertJsonApi(res);
    const body = res.json() as { data: { type: string; attributes: Record<string, unknown> } };
    expect(body.data.type).toBe('sync-runs');

    const employees = await ctx.prisma.employeeHcmMapping.count();
    const leaveTypes = await ctx.prisma.leaveType.count();
    const balances = await ctx.prisma.leaveBalance.count();
    expect(employees).toBeGreaterThan(0);
    expect(leaveTypes).toBeGreaterThan(0);
    expect(balances).toBeGreaterThan(0);
  });

  it('allows integration_client', async () => {
    const token = ctx.token('integration_client', { sub: 'integration-client' });
    const res = await ctx.app.inject({
      method: 'POST',
      url: '/api/v1/sync/time-off',
      headers: authHeaders(token, ''),
    });
    expect(res.statusCode).toBe(201);
  });

  it('returns 403 for employee and manager', async () => {
    const aliceToken = ctx.token('employee', { sub: 'alice', employeeId: ctx.aliceId });
    const bobToken = ctx.token('manager', { sub: 'bob', employeeId: ctx.bobId });

    const employeeRes = await ctx.app.inject({
      method: 'POST',
      url: '/api/v1/sync/time-off',
      headers: authHeaders(aliceToken, ''),
    });
    expect(employeeRes.statusCode).toBe(403);

    const managerRes = await ctx.app.inject({
      method: 'POST',
      url: '/api/v1/sync/time-off',
      headers: authHeaders(bobToken, ''),
    });
    expect(managerRes.statusCode).toBe(403);
  });

  it('is idempotent on retry', async () => {
    const beforeEmployees = await ctx.prisma.employeeHcmMapping.count();
    const beforeLeaveTypes = await ctx.prisma.leaveType.count();
    const token = ctx.token('system_admin', { sub: 'admin' });

    await ctx.app.inject({
      method: 'POST',
      url: '/api/v1/sync/time-off',
      headers: authHeaders(token, ''),
    });

    expect(await ctx.prisma.employeeHcmMapping.count()).toBe(beforeEmployees);
    expect(await ctx.prisma.leaveType.count()).toBe(beforeLeaveTypes);
  });
});

describe('IT-1.5 GET /api/v1/sync/status', () => {
  let ctx: IntegrationContext;

  beforeAll(async () => {
    ctx = await setupIntegrationContext();
  });

  afterAll(async () => {
    await teardownIntegrationContext(ctx);
  });

  it('returns 200 for hr_admin with staleness and counts', async () => {
    const token = ctx.token('hr_admin', { sub: 'carol', employeeId: ctx.carolId });
    const res = await ctx.app.inject({
      method: 'GET',
      url: '/api/v1/sync/status',
      headers: authHeaders(token, ''),
    });
    expect(res.statusCode).toBe(200);
    assertJsonApi(res);
    const attrs = res.json().data.attributes;
    expect(attrs).toHaveProperty('lastSyncStatus');
    expect(attrs).toHaveProperty('employeeCount');
    expect(attrs).toHaveProperty('balanceCount');
  });

  it('returns 403 for employee', async () => {
    const token = ctx.token('employee', { sub: 'alice', employeeId: ctx.aliceId });
    const res = await ctx.app.inject({
      method: 'GET',
      url: '/api/v1/sync/status',
      headers: authHeaders(token, ''),
    });
    expect(res.statusCode).toBe(403);
  });
});

describe('§14.2 sync workflow isolation', () => {
  let ctx: IntegrationContext;

  beforeAll(async () => {
    ctx = await setupIntegrationContext();
  });

  afterAll(async () => {
    await teardownIntegrationContext(ctx);
  });

  it('does not mutate leave request workflow state on re-sync', async () => {
    const token = ctx.token('employee', { sub: 'alice', employeeId: ctx.aliceId });
    const createRes = await ctx.app.inject({
      method: 'POST',
      url: '/api/v1/leave-requests',
      headers: authHeaders(token),
      payload: {
        data: {
          type: 'leave-requests',
          attributes: {
            startDate: '2026-09-01',
            endDate: '2026-09-02',
            submit: true,
            dimensions: { locationId: 'US-NY' },
          },
          relationships: {
            employee: { data: { type: 'employees', id: ctx.aliceId } },
            leaveType: { data: { type: 'leave-types', id: ctx.leaveTypeId } },
          },
        },
      },
    });
    expect(createRes.statusCode).toBe(201);
    const requestId = createRes.json().data.id;

    const adminToken = ctx.token('system_admin', { sub: 'admin' });
    await ctx.app.inject({
      method: 'POST',
      url: '/api/v1/sync/time-off',
      headers: authHeaders(adminToken, ''),
    });

    const request = await ctx.prisma.leaveRequest.findUniqueOrThrow({ where: { id: requestId } });
    expect(request.status).toBe('PENDING');
  });
});
