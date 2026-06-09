import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import {
  setupIntegrationContext,
  teardownIntegrationContext,
  authHeaders,
  leaveRequestPayload,
  seedHcmPendingRequest,
  type IntegrationContext,
} from '../helpers/integration.js';
import {
  resetMockMetrics,
  getRequestTimeOffCallCount,
  setMockScenario,
} from '../../tools/workday-mock/server.js';

async function submitAliceRequest(
  ctx: IntegrationContext,
  dates: { start: string; end: string },
): Promise<string> {
  const token = ctx.token('employee', { sub: 'alice', employeeId: ctx.aliceId });
  const res = await ctx.inject({
    method: 'POST',
    url: '/api/v1/leave-requests',
    headers: authHeaders(token),
    payload: leaveRequestPayload(ctx.aliceId, ctx.leaveTypeId, {
      startDate: dates.start,
      endDate: dates.end,
      submit: true,
      dimensions: { locationId: 'US-NY' },
    }),
  });
  expect(res.statusCode).toBe(201);
  return res.json().data.id;
}

describe('IT-1.13 GET /api/v1/approvals/pending', () => {
  let ctx: IntegrationContext;

  beforeAll(async () => {
    ctx = await setupIntegrationContext();
    await submitAliceRequest(ctx, { start: '2028-01-05', end: '2028-01-06' });
  });

  afterAll(async () => {
    await teardownIntegrationContext(ctx);
  });

  it('returns pending step for assigned manager', async () => {
    const token = ctx.token('manager', { sub: 'bob', employeeId: ctx.bobId });
    const res = await ctx.inject({
      method: 'GET',
      url: '/api/v1/approvals/pending',
      headers: authHeaders(token, ''),
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().data.length).toBeGreaterThan(0);
  });

  it('returns 403 for employee', async () => {
    const token = ctx.token('employee', { sub: 'alice', employeeId: ctx.aliceId });
    const res = await ctx.inject({
      method: 'GET',
      url: '/api/v1/approvals/pending',
      headers: authHeaders(token, ''),
    });
    expect(res.statusCode).toBe(403);
  });
});

describe('IT-1.14 POST /api/v1/leave-requests/{id}/approve', () => {
  let ctx: IntegrationContext;

  beforeAll(async () => {
    ctx = await setupIntegrationContext();
  });

  afterAll(async () => {
    await teardownIntegrationContext(ctx);
  });

  beforeEach(() => {
    resetMockMetrics();
  });

  it('approves with requestTimeOff, CONFIRMED_USAGE, and hcmReferenceId', async () => {
    const requestId = await submitAliceRequest(ctx, { start: '2028-02-01', end: '2028-02-03' });
    const token = ctx.token('manager', { sub: 'bob', employeeId: ctx.bobId });
    const res = await ctx.inject({
      method: 'POST',
      url: `/api/v1/leave-requests/${requestId}/approve`,
      headers: authHeaders(token),
      payload: { data: { type: 'approvals', attributes: { comment: 'Approved' } } },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().data.attributes.status).toBe('APPROVED');
    expect(res.json().data.attributes.hcmReferenceId).toBeTruthy();
    expect(getRequestTimeOffCallCount()).toBe(1);

    const usage = await ctx.prisma.leaveBalanceLedger.findFirst({
      where: { leaveRequestId: requestId, entryType: 'CONFIRMED_USAGE' },
    });
    expect(usage).toBeTruthy();

    const release = await ctx.prisma.leaveBalanceLedger.findFirst({
      where: { leaveRequestId: requestId, entryType: 'RESERVATION_RELEASE' },
    });
    expect(release).toBeTruthy();

    const approved = await ctx.prisma.leaveRequest.findUniqueOrThrow({ where: { id: requestId } });
    const usedDays = Number(approved.durationDays);

    const aliceToken = ctx.token('employee', { sub: 'alice', employeeId: ctx.aliceId });
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

  it('returns APPROVED_PENDING_HCM_UPDATE when HCM is down', async () => {
    const requestId = await submitAliceRequest(ctx, { start: '2028-03-01', end: '2028-03-02' });
    setMockScenario({ simulateUnavailable: true });
    const token = ctx.token('manager', { sub: 'bob', employeeId: ctx.bobId });
    const res = await ctx.inject({
      method: 'POST',
      url: `/api/v1/leave-requests/${requestId}/approve`,
      headers: authHeaders(token),
      payload: { data: { type: 'approvals', attributes: {} } },
    });
    resetMockMetrics();
    expect(res.statusCode).toBe(200);
    expect(res.json().data.attributes.status).toBe('APPROVED_PENDING_HCM_UPDATE');
  });

  it('returns 403 for non-approver', async () => {
    const requestId = await submitAliceRequest(ctx, { start: '2028-04-01', end: '2028-04-02' });
    const token = ctx.token('employee', { sub: 'alice', employeeId: ctx.aliceId });
    const res = await ctx.inject({
      method: 'POST',
      url: `/api/v1/leave-requests/${requestId}/approve`,
      headers: authHeaders(token),
      payload: { data: { type: 'approvals', attributes: {} } },
    });
    expect(res.statusCode).toBe(403);
  });

  it('returns 422 for already terminal request', async () => {
    const requestId = await submitAliceRequest(ctx, { start: '2028-05-01', end: '2028-05-02' });
    const bobToken = ctx.token('manager', { sub: 'bob', employeeId: ctx.bobId });
    await ctx.inject({
      method: 'POST',
      url: `/api/v1/leave-requests/${requestId}/reject`,
      headers: authHeaders(bobToken),
      payload: { data: { type: 'approvals', attributes: {} } },
    });
    const res = await ctx.inject({
      method: 'POST',
      url: `/api/v1/leave-requests/${requestId}/approve`,
      headers: authHeaders(bobToken),
      payload: { data: { type: 'approvals', attributes: {} } },
    });
    expect(res.statusCode).toBe(422);
  });
});

describe('IT-1.15 POST /api/v1/leave-requests/{id}/reject', () => {
  let ctx: IntegrationContext;

  beforeAll(async () => {
    ctx = await setupIntegrationContext();
  });

  afterAll(async () => {
    await teardownIntegrationContext(ctx);
  });

  beforeEach(() => {
    resetMockMetrics();
  });

  it('rejects with RESERVATION_RELEASE and no HCM write', async () => {
    const requestId = await submitAliceRequest(ctx, { start: '2028-06-01', end: '2028-06-02' });
    const callsBefore = getRequestTimeOffCallCount();
    const token = ctx.token('manager', { sub: 'bob', employeeId: ctx.bobId });
    const res = await ctx.inject({
      method: 'POST',
      url: `/api/v1/leave-requests/${requestId}/reject`,
      headers: authHeaders(token),
      payload: { data: { type: 'approvals', attributes: { comment: 'No' } } },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().data.attributes.status).toBe('REJECTED');
    expect(getRequestTimeOffCallCount()).toBe(callsBefore);

    const ledger = await ctx.prisma.leaveBalanceLedger.findFirst({
      where: { leaveRequestId: requestId, entryType: 'RESERVATION_RELEASE' },
    });
    expect(ledger).toBeTruthy();
  });

  it('returns 403 for non-approver', async () => {
    const requestId = await submitAliceRequest(ctx, { start: '2028-07-01', end: '2028-07-02' });
    const token = ctx.token('employee', { sub: 'alice', employeeId: ctx.aliceId });
    const res = await ctx.inject({
      method: 'POST',
      url: `/api/v1/leave-requests/${requestId}/reject`,
      headers: authHeaders(token),
      payload: { data: { type: 'approvals', attributes: {} } },
    });
    expect(res.statusCode).toBe(403);
  });
});

describe('§14.2 HCM approval retry workflow', () => {
  let ctx: IntegrationContext;

  beforeAll(async () => {
    ctx = await setupIntegrationContext();
  });

  afterAll(async () => {
    await teardownIntegrationContext(ctx);
  });

  beforeEach(() => {
    resetMockMetrics();
    setMockScenario({ simulateUnavailable: false });
  });

  it('retry job promotes APPROVED_PENDING_HCM_UPDATE to APPROVED', async () => {
    const { requestId } = await seedHcmPendingRequest(ctx.prisma, {
      employeeId: ctx.aliceId,
      leaveTypeId: ctx.leaveTypeId,
      approverEmployeeId: ctx.bobId,
      startDate: '2028-08-01',
      endDate: '2028-08-02',
      durationDays: 2,
      hcmRetryDeadlineAt: new Date(Date.now() + 86_400_000),
    });

    await ctx.runHcmApprovalRetry();

    const request = await ctx.prisma.leaveRequest.findUniqueOrThrow({ where: { id: requestId } });
    expect(request.status).toBe('APPROVED');
    expect(request.hcmReferenceId).toBeTruthy();
  });

  it('exhausted retries auto-reject with RESERVATION_RELEASE', async () => {
    const { requestId } = await seedHcmPendingRequest(ctx.prisma, {
      employeeId: ctx.aliceId,
      leaveTypeId: ctx.leaveTypeId,
      approverEmployeeId: ctx.bobId,
      startDate: '2028-09-01',
      endDate: '2028-09-02',
      durationDays: 2,
      hcmRetryDeadlineAt: new Date(Date.now() - 60_000),
    });

    await ctx.runHcmApprovalRetry();

    const request = await ctx.prisma.leaveRequest.findUniqueOrThrow({ where: { id: requestId } });
    expect(request.status).toBe('REJECTED');

    const ledger = await ctx.prisma.leaveBalanceLedger.findFirst({
      where: { leaveRequestId: requestId, entryType: 'RESERVATION_RELEASE' },
    });
    expect(ledger).toBeTruthy();
  });

  it('IT-2.9 exhausted retries emit HCM_APPROVAL_SYNC_FAILED notification', async () => {
    await seedHcmPendingRequest(ctx.prisma, {
      employeeId: ctx.aliceId,
      leaveTypeId: ctx.leaveTypeId,
      approverEmployeeId: ctx.bobId,
      startDate: '2028-10-01',
      endDate: '2028-10-02',
      durationDays: 2,
      hcmRetryDeadlineAt: new Date(Date.now() - 60_000),
    });

    await ctx.runHcmApprovalRetry();

    const notification = await ctx.prisma.notification.findFirst({
      where: { type: 'HCM_APPROVAL_SYNC_FAILED', recipientEmployeeId: ctx.aliceId },
    });
    expect(notification).toBeTruthy();
    expect((notification!.payload as Record<string, unknown>).email).toBe('alice.employee@example.com');
  });
});
