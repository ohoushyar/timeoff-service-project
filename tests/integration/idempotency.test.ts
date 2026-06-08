import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import {
  setupIntegrationContext,
  teardownIntegrationContext,
  authHeaders,
  idempotencyHeaders,
  leaveRequestPayload,
  type IntegrationContext,
} from '../helpers/integration.js';
import { resetMockMetrics, getRequestTimeOffCallCount } from '../../tools/workday-mock/server.js';

describe('IT-2.6 Idempotency-Key on POST /api/v1/leave-requests', () => {
  let ctx: IntegrationContext;

  beforeAll(async () => {
    ctx = await setupIntegrationContext();
  });

  afterAll(async () => {
    await teardownIntegrationContext(ctx);
  });

  it('same key + body returns cached 201', async () => {
    const token = ctx.token('employee', { sub: 'alice', employeeId: ctx.aliceId });
    const key = '11111111-1111-1111-1111-111111111111';
    const payload = leaveRequestPayload(ctx.aliceId, ctx.leaveTypeId, {
      startDate: '2030-01-14',
      endDate: '2030-01-15',
      submit: true,
      dimensions: { locationId: 'US-NY' },
    });

    const first = await ctx.app.inject({
      method: 'POST',
      url: '/api/v1/leave-requests',
      headers: idempotencyHeaders(token, key),
      payload,
    });
    expect(first.statusCode).toBe(201);
    const firstId = first.json().data.id;

    const second = await ctx.app.inject({
      method: 'POST',
      url: '/api/v1/leave-requests',
      headers: idempotencyHeaders(token, key),
      payload,
    });
    expect(second.statusCode).toBe(201);
    expect(second.json().data.id).toBe(firstId);
  });

  it('different body with same key returns 409', async () => {
    const token = ctx.token('employee', { sub: 'alice', employeeId: ctx.aliceId });
    const key = '22222222-2222-2222-2222-222222222222';

    const firstRes = await ctx.app.inject({
      method: 'POST',
      url: '/api/v1/leave-requests',
      headers: idempotencyHeaders(token, key),
      payload: leaveRequestPayload(ctx.aliceId, ctx.leaveTypeId, {
        startDate: '2030-02-12',
        endDate: '2030-02-13',
        submit: true,
        dimensions: { locationId: 'US-NY' },
      }),
    });
    expect(firstRes.statusCode).toBe(201);

    const conflict = await ctx.app.inject({
      method: 'POST',
      url: '/api/v1/leave-requests',
      headers: idempotencyHeaders(token, key),
      payload: leaveRequestPayload(ctx.aliceId, ctx.leaveTypeId, {
        startDate: '2030-02-14',
        endDate: '2030-02-15',
        submit: true,
        dimensions: { locationId: 'US-NY' },
      }),
    });
    expect(conflict.statusCode).toBe(409);
    expect(conflict.json().errors[0].code).toBe('IDEMPOTENCY_CONFLICT');
  });
});

describe('IT-2.7 Idempotency-Key on approve/reject/sync', () => {
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

  it('approve replay returns identical response without duplicate HCM side effects', async () => {
    const employeeToken = ctx.token('employee', { sub: 'alice', employeeId: ctx.aliceId });
    const createRes = await ctx.app.inject({
      method: 'POST',
      url: '/api/v1/leave-requests',
      headers: authHeaders(employeeToken),
      payload: leaveRequestPayload(ctx.aliceId, ctx.leaveTypeId, {
        startDate: '2030-03-12',
        endDate: '2030-03-13',
        submit: true,
        dimensions: { locationId: 'US-NY' },
      }),
    });
    expect(createRes.statusCode).toBe(201);
    const requestId = createRes.json().data.id;
    const managerToken = ctx.token('manager', { sub: 'bob', employeeId: ctx.bobId });
    const key = '33333333-3333-3333-3333-333333333333';
    const approvePayload = { data: { type: 'approvals', attributes: { comment: 'ok' } } };

    const first = await ctx.app.inject({
      method: 'POST',
      url: `/api/v1/leave-requests/${requestId}/approve`,
      headers: idempotencyHeaders(managerToken, key),
      payload: approvePayload,
    });
    expect(first.statusCode).toBe(200);

    const second = await ctx.app.inject({
      method: 'POST',
      url: `/api/v1/leave-requests/${requestId}/approve`,
      headers: idempotencyHeaders(managerToken, key),
      payload: approvePayload,
    });
    expect(second.statusCode).toBe(200);
    expect(second.json().data.id).toBe(first.json().data.id);
    expect(getRequestTimeOffCallCount()).toBe(1);
  });
});
