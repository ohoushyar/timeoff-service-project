import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import {
  setupIntegrationContext,
  teardownIntegrationContext,
  authHeaders,
  leaveRequestPayload,
  assertJsonApi,
  type IntegrationContext,
} from '../helpers/integration.js';

describe('IT-1.16 GET /api/v1/employees/{id}/balances', () => {
  let ctx: IntegrationContext;

  beforeAll(async () => {
    ctx = await setupIntegrationContext();
  });

  afterAll(async () => {
    await teardownIntegrationContext(ctx);
  });

  it('returns balance attributes for self, manager, and hr', async () => {
    const aliceToken = ctx.token('employee', { sub: 'alice', employeeId: ctx.aliceId });
    const bobToken = ctx.token('manager', { sub: 'bob', employeeId: ctx.bobId });
    const carolToken = ctx.token('hr_admin', { sub: 'carol', employeeId: ctx.carolId });

    for (const token of [aliceToken, bobToken, carolToken]) {
      const res = await ctx.inject({
        method: 'GET',
        url: `/api/v1/employees/${ctx.aliceId}/balances`,
        headers: authHeaders(token, ''),
      });
      expect(res.statusCode).toBe(200);
      assertJsonApi(res);
      const attrs = res.json().data[0].attributes;
      expect(attrs).toMatchObject({
        currentBalance: expect.anything(),
        ledgerBalance: expect.anything(),
        pendingBalance: expect.anything(),
        availableBalance: expect.anything(),
        lastSyncedAt: expect.any(String),
        unit: expect.any(String),
      });
    }
  });

  it('returns 403 for unrelated employee', async () => {
    const token = ctx.token('employee', { sub: 'alice', employeeId: ctx.aliceId });
    const res = await ctx.inject({
      method: 'GET',
      url: `/api/v1/employees/${ctx.bobId}/balances`,
      headers: authHeaders(token, ''),
    });
    expect(res.statusCode).toBe(403);
  });

  it('deducts once after cancel, resubmit, and approve (no double debit)', async () => {
    const aliceToken = ctx.token('employee', { sub: 'alice', employeeId: ctx.aliceId });
    const bobToken = ctx.token('manager', { sub: 'bob', employeeId: ctx.bobId });

    const first = await ctx.inject({
      method: 'POST',
      url: '/api/v1/leave-requests',
      headers: authHeaders(aliceToken),
      payload: leaveRequestPayload(ctx.aliceId, ctx.leaveTypeId, {
        startDate: '2028-02-01',
        endDate: '2028-02-02',
        submit: true,
        dimensions: { locationId: 'US-NY' },
      }),
    });
    expect(first.statusCode).toBe(201);
    const firstId = first.json().data.id;

    const cancelRes = await ctx.inject({
      method: 'POST',
      url: `/api/v1/leave-requests/${firstId}/cancel`,
      headers: authHeaders(aliceToken, ''),
    });
    expect(cancelRes.statusCode).toBe(200);

    const second = await ctx.inject({
      method: 'POST',
      url: '/api/v1/leave-requests',
      headers: authHeaders(aliceToken),
      payload: leaveRequestPayload(ctx.aliceId, ctx.leaveTypeId, {
        startDate: '2028-03-01',
        endDate: '2028-03-02',
        submit: true,
        dimensions: { locationId: 'US-NY' },
      }),
    });
    expect(second.statusCode).toBe(201);
    const secondId = second.json().data.id;

    const approveRes = await ctx.inject({
      method: 'POST',
      url: `/api/v1/leave-requests/${secondId}/approve`,
      headers: authHeaders(bobToken),
      payload: { data: { type: 'approvals', attributes: {} } },
    });
    expect(approveRes.statusCode).toBe(200);

    const approved = await ctx.prisma.leaveRequest.findUniqueOrThrow({ where: { id: secondId } });
    const usedDays = Number(approved.durationDays);

    const balanceRes = await ctx.inject({
      method: 'GET',
      url: `/api/v1/employees/${ctx.aliceId}/balances`,
      headers: authHeaders(aliceToken, ''),
    });
    expect(balanceRes.statusCode).toBe(200);

    const vacation = balanceRes.json().data.find(
      (b: { relationships: { leaveType: { data: { id: string } } } }) =>
        b.relationships.leaveType.data.id === ctx.leaveTypeId,
    );
    expect(vacation.attributes).toMatchObject({
      currentBalance: 10,
      ledgerBalance: 10 - usedDays,
      pendingBalance: 0,
      availableBalance: 10 - usedDays,
    });
  });
});

describe('IT-1.17 GET /api/v1/employees/{id}/balance-ledger', () => {
  let ctx: IntegrationContext;

  beforeAll(async () => {
    ctx = await setupIntegrationContext();
    const token = ctx.token('employee', { sub: 'alice', employeeId: ctx.aliceId });
    await ctx.inject({
      method: 'POST',
      url: '/api/v1/leave-requests',
      headers: authHeaders(token),
      payload: leaveRequestPayload(ctx.aliceId, ctx.leaveTypeId, {
        startDate: '2029-01-05',
        endDate: '2029-01-06',
        submit: true,
        dimensions: { locationId: 'US-NY' },
      }),
    });
  });

  afterAll(async () => {
    await teardownIntegrationContext(ctx);
  });

  it('returns paginated workflow ledger entries', async () => {
    const token = ctx.token('employee', { sub: 'alice', employeeId: ctx.aliceId });
    const res = await ctx.inject({
      method: 'GET',
      url: `/api/v1/employees/${ctx.aliceId}/balance-ledger?page[number]=1&page[size]=20`,
      headers: authHeaders(token, ''),
    });
    expect(res.statusCode).toBe(200);
    assertJsonApi(res);
    expect(res.json().meta.totalCount).toBeGreaterThan(0);
    const entry = res.json().data.find(
      (e: { attributes: { entryType: string } }) => e.attributes.entryType === 'PENDING_RESERVATION',
    );
    expect(entry).toBeTruthy();
    expect(entry.attributes).toMatchObject({
      entryType: 'PENDING_RESERVATION',
      source: 'WORKFLOW',
      amount: expect.anything(),
    });
  });

  it('returns 403 for unrelated employee', async () => {
    const token = ctx.token('employee', { sub: 'alice', employeeId: ctx.aliceId });
    const res = await ctx.inject({
      method: 'GET',
      url: `/api/v1/employees/${ctx.bobId}/balance-ledger`,
      headers: authHeaders(token, ''),
    });
    expect(res.statusCode).toBe(403);
  });
});
