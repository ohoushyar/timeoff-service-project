import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import {
  setupIntegrationContext,
  teardownIntegrationContext,
  authHeaders,
  leaveRequestPayload,
  assertJsonApi,
  type IntegrationContext,
} from '../helpers/integration.js';
import {
  resetMockMetrics,
  getRequestTimeOffCallCount,
  setMockScenario,
} from '../../tools/workday-mock/server.js';

describe('IT-1.8 POST /api/v1/leave-requests', () => {
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

  it('creates DRAFT when submit is false', async () => {
    const token = ctx.token('employee', { sub: 'alice', employeeId: ctx.aliceId });
    const res = await ctx.inject({
      method: 'POST',
      url: '/api/v1/leave-requests',
      headers: authHeaders(token),
      payload: leaveRequestPayload(ctx.aliceId, ctx.leaveTypeId, {
        startDate: '2026-10-01',
        endDate: '2026-10-02',
        submit: false,
        dimensions: { locationId: 'US-NY' },
      }),
    });
    expect(res.statusCode).toBe(201);
    expect(res.json().data.attributes.status).toBe('DRAFT');
  });

  it('submit creates PENDING with PENDING_RESERVATION ledger and no requestTimeOff call', async () => {
    const token = ctx.token('employee', { sub: 'alice', employeeId: ctx.aliceId });
    const res = await ctx.inject({
      method: 'POST',
      url: '/api/v1/leave-requests',
      headers: authHeaders(token),
      payload: leaveRequestPayload(ctx.aliceId, ctx.leaveTypeId, {
        startDate: '2026-10-05',
        endDate: '2026-10-07',
        submit: true,
        dimensions: { locationId: 'US-NY' },
      }),
    });
    expect(res.statusCode).toBe(201);
    expect(res.json().data.attributes.status).toBe('PENDING');
    expect(getRequestTimeOffCallCount()).toBe(0);

    const ledger = await ctx.prisma.leaveBalanceLedger.findFirst({
      where: { entryType: 'PENDING_RESERVATION', leaveRequestId: res.json().data.id },
    });
    expect(ledger).toBeTruthy();
  });

  it('returns 422 for insufficient balance', async () => {
    const token = ctx.token('employee', { sub: 'alice', employeeId: ctx.aliceId });
    const res = await ctx.inject({
      method: 'POST',
      url: '/api/v1/leave-requests',
      headers: authHeaders(token),
      payload: leaveRequestPayload(ctx.aliceId, ctx.leaveTypeId, {
        startDate: '2026-11-01',
        endDate: '2026-11-20',
        submit: true,
        dimensions: { locationId: 'US-NY' },
      }),
    });
    expect(res.statusCode).toBe(422);
    expect(res.json().errors[0].code).toBe('INSUFFICIENT_BALANCE');
  });

  it('returns 422 for overlapping request', async () => {
    const token = ctx.token('employee', { sub: 'alice', employeeId: ctx.aliceId });
    const payload = leaveRequestPayload(ctx.aliceId, ctx.leaveTypeId, {
      startDate: '2026-12-01',
      endDate: '2026-12-03',
      submit: true,
      dimensions: { locationId: 'US-NY' },
    });
    await ctx.inject({
      method: 'POST',
      url: '/api/v1/leave-requests',
      headers: authHeaders(token),
      payload,
    });
    const res = await ctx.inject({
      method: 'POST',
      url: '/api/v1/leave-requests',
      headers: authHeaders(token),
      payload,
    });
    expect(res.statusCode).toBe(422);
    expect(res.json().errors[0].code).toBe('OVERLAPPING_REQUEST');
  });

  it('returns 422 for invalid dimensions', async () => {
    const token = ctx.token('employee', { sub: 'alice', employeeId: ctx.aliceId });
    const res = await ctx.inject({
      method: 'POST',
      url: '/api/v1/leave-requests',
      headers: authHeaders(token),
      payload: leaveRequestPayload(ctx.aliceId, ctx.leaveTypeId, {
        startDate: '2027-01-05',
        endDate: '2027-01-06',
        submit: true,
        dimensions: { locationId: 'INVALID-LOC' },
      }),
    });
    expect(res.statusCode).toBe(422);
    expect(res.json().errors[0].code).toBe('INVALID_TIME_OFF_DIMENSIONS');
  });

  it('returns 403 when creating for another employee without HR role', async () => {
    const token = ctx.token('employee', { sub: 'alice', employeeId: ctx.aliceId });
    const res = await ctx.inject({
      method: 'POST',
      url: '/api/v1/leave-requests',
      headers: authHeaders(token),
      payload: leaveRequestPayload(ctx.bobId, ctx.leaveTypeId, {
        startDate: '2027-02-01',
        endDate: '2027-02-02',
        submit: false,
        dimensions: { locationId: 'US-NY' },
      }),
    });
    expect(res.statusCode).toBe(403);
  });

  it('submit with HCM balance read failure still creates pending workflow', async () => {
    setMockScenario({ simulateUnavailable: true });
    const token = ctx.token('employee', { sub: 'alice', employeeId: ctx.aliceId });
    const res = await ctx.inject({
      method: 'POST',
      url: '/api/v1/leave-requests',
      headers: authHeaders(token),
      payload: leaveRequestPayload(ctx.aliceId, ctx.leaveTypeId, {
        startDate: '2027-03-01',
        endDate: '2027-03-02',
        submit: true,
        dimensions: { locationId: 'US-NY' },
      }),
    });
    resetMockMetrics();
    expect(res.statusCode).toBe(201);
    expect(res.json().data.attributes.status).toBe('PENDING');
    expect(getRequestTimeOffCallCount()).toBe(0);
  });
});

describe('IT-1.9 GET /api/v1/leave-requests', () => {
  let ctx: IntegrationContext;
  let aliceRequestId: string;

  beforeAll(async () => {
    ctx = await setupIntegrationContext();
    const token = ctx.token('employee', { sub: 'alice', employeeId: ctx.aliceId });
    const res = await ctx.inject({
      method: 'POST',
      url: '/api/v1/leave-requests',
      headers: authHeaders(token),
      payload: leaveRequestPayload(ctx.aliceId, ctx.leaveTypeId, {
        startDate: '2027-04-01',
        endDate: '2027-04-02',
        submit: true,
        dimensions: { locationId: 'US-NY' },
      }),
    });
    aliceRequestId = res.json().data.id;
  });

  afterAll(async () => {
    await teardownIntegrationContext(ctx);
  });

  it('returns own requests only for employee', async () => {
    const token = ctx.token('employee', { sub: 'alice', employeeId: ctx.aliceId });
    const res = await ctx.inject({
      method: 'GET',
      url: '/api/v1/leave-requests',
      headers: authHeaders(token, ''),
    });
    expect(res.statusCode).toBe(200);
    assertJsonApi(res);
    expect(res.json().data.every((r: { id: string }) => r.id === aliceRequestId)).toBe(true);
  });

  it('manager sees team requests with filter and pagination', async () => {
    const token = ctx.token('manager', { sub: 'bob', employeeId: ctx.bobId });
    const res = await ctx.inject({
      method: 'GET',
      url: '/api/v1/leave-requests?filter[status]=pending&filter[employeeId]=' + ctx.aliceId + '&page[number]=1&page[size]=10',
      headers: authHeaders(token, ''),
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().data.some((r: { id: string }) => r.id === aliceRequestId)).toBe(true);
    expect(res.json().meta.pageNumber).toBe(1);
  });
});

describe('IT-1.10 GET /api/v1/leave-requests/{id}', () => {
  let ctx: IntegrationContext;
  let requestId: string;

  beforeAll(async () => {
    ctx = await setupIntegrationContext();
    const token = ctx.token('employee', { sub: 'alice', employeeId: ctx.aliceId });
    const res = await ctx.inject({
      method: 'POST',
      url: '/api/v1/leave-requests',
      headers: authHeaders(token),
      payload: leaveRequestPayload(ctx.aliceId, ctx.leaveTypeId, {
        startDate: '2027-05-01',
        endDate: '2027-05-02',
        submit: true,
        dimensions: { locationId: 'US-NY' },
      }),
    });
    requestId = res.json().data.id;
  });

  afterAll(async () => {
    await teardownIntegrationContext(ctx);
  });

  it('returns 200 for owner, manager, and hr', async () => {
    const aliceToken = ctx.token('employee', { sub: 'alice', employeeId: ctx.aliceId });
    const bobToken = ctx.token('manager', { sub: 'bob', employeeId: ctx.bobId });
    const carolToken = ctx.token('hr_admin', { sub: 'carol', employeeId: ctx.carolId });

    for (const token of [aliceToken, bobToken, carolToken]) {
      const res = await ctx.inject({
        method: 'GET',
        url: `/api/v1/leave-requests/${requestId}`,
        headers: authHeaders(token, ''),
      });
      expect(res.statusCode).toBe(200);
    }
  });

  it('returns 403 for unrelated employee', async () => {
    const carolEmployeeToken = ctx.token('employee', { sub: 'carol', employeeId: ctx.carolId });
    const res = await ctx.inject({
      method: 'GET',
      url: `/api/v1/leave-requests/${requestId}`,
      headers: authHeaders(carolEmployeeToken, ''),
    });
    expect(res.statusCode).toBe(403);
  });

  it('returns 404 for unknown id', async () => {
    const token = ctx.token('employee', { sub: 'alice', employeeId: ctx.aliceId });
    const res = await ctx.inject({
      method: 'GET',
      url: '/api/v1/leave-requests/00000000-0000-4000-8000-000000000099',
      headers: authHeaders(token, ''),
    });
    expect(res.statusCode).toBe(404);
  });
});

describe('IT-1.11 PATCH /api/v1/leave-requests/{id}', () => {
  let ctx: IntegrationContext;

  beforeAll(async () => {
    ctx = await setupIntegrationContext();
  });

  afterAll(async () => {
    await teardownIntegrationContext(ctx);
  });

  it('updates draft fields', async () => {
    const token = ctx.token('employee', { sub: 'alice', employeeId: ctx.aliceId });
    const createRes = await ctx.inject({
      method: 'POST',
      url: '/api/v1/leave-requests',
      headers: authHeaders(token),
      payload: leaveRequestPayload(ctx.aliceId, ctx.leaveTypeId, {
        startDate: '2027-06-01',
        endDate: '2027-06-02',
        submit: false,
        dimensions: { locationId: 'US-NY' },
        reason: 'Original',
      }),
    });
    const id = createRes.json().data.id;

    const patchRes = await ctx.inject({
      method: 'PATCH',
      url: `/api/v1/leave-requests/${id}`,
      headers: authHeaders(token),
      payload: { data: { type: 'leave-requests', attributes: { reason: 'Updated reason' } } },
    });
    expect(patchRes.statusCode).toBe(200);
    expect(patchRes.json().data.attributes.reason).toBe('Updated reason');
  });

  it('returns 422 when patching non-draft', async () => {
    const token = ctx.token('employee', { sub: 'alice', employeeId: ctx.aliceId });
    const createRes = await ctx.inject({
      method: 'POST',
      url: '/api/v1/leave-requests',
      headers: authHeaders(token),
      payload: leaveRequestPayload(ctx.aliceId, ctx.leaveTypeId, {
        startDate: '2027-07-01',
        endDate: '2027-07-02',
        submit: true,
        dimensions: { locationId: 'US-NY' },
      }),
    });
    const id = createRes.json().data.id;

    const patchRes = await ctx.inject({
      method: 'PATCH',
      url: `/api/v1/leave-requests/${id}`,
      headers: authHeaders(token),
      payload: { data: { type: 'leave-requests', attributes: { reason: 'Too late' } } },
    });
    expect(patchRes.statusCode).toBe(422);
  });

  it('returns 403 for non-owner without HR', async () => {
    const aliceToken = ctx.token('employee', { sub: 'alice', employeeId: ctx.aliceId });
    const bobToken = ctx.token('manager', { sub: 'bob', employeeId: ctx.bobId });
    const createRes = await ctx.inject({
      method: 'POST',
      url: '/api/v1/leave-requests',
      headers: authHeaders(aliceToken),
      payload: leaveRequestPayload(ctx.aliceId, ctx.leaveTypeId, {
        startDate: '2027-08-10',
        endDate: '2027-08-11',
        submit: false,
        dimensions: { locationId: 'US-NY' },
      }),
    });
    expect(createRes.statusCode).toBe(201);
    const id = createRes.json().data.id;

    const patchRes = await ctx.inject({
      method: 'PATCH',
      url: `/api/v1/leave-requests/${id}`,
      headers: authHeaders(bobToken),
      payload: { data: { type: 'leave-requests', attributes: { reason: 'Nope' } } },
    });
    expect(patchRes.statusCode).toBe(403);
  });
});

describe('IT-1.12 POST /api/v1/leave-requests/{id}/cancel', () => {
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

  it('cancels PENDING with RESERVATION_RELEASE and no HCM call', async () => {
    const token = ctx.token('employee', { sub: 'alice', employeeId: ctx.aliceId });
    const createRes = await ctx.inject({
      method: 'POST',
      url: '/api/v1/leave-requests',
      headers: authHeaders(token),
      payload: leaveRequestPayload(ctx.aliceId, ctx.leaveTypeId, {
        startDate: '2027-09-01',
        endDate: '2027-09-02',
        submit: true,
        dimensions: { locationId: 'US-NY' },
      }),
    });
    const id = createRes.json().data.id;
    const callsBefore = getRequestTimeOffCallCount();

    const cancelRes = await ctx.inject({
      method: 'POST',
      url: `/api/v1/leave-requests/${id}/cancel`,
      headers: authHeaders(token, ''),
    });
    expect(cancelRes.statusCode).toBe(200);
    expect(cancelRes.json().data.attributes.status).toBe('CANCELLED');
    expect(getRequestTimeOffCallCount()).toBe(callsBefore);

    const ledger = await ctx.prisma.leaveBalanceLedger.findFirst({
      where: { leaveRequestId: id, entryType: 'RESERVATION_RELEASE' },
    });
    expect(ledger).toBeTruthy();
  });
});
