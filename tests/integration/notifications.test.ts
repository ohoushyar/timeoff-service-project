import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import {
  setupIntegrationContext,
  teardownIntegrationContext,
  authHeaders,
  leaveRequestPayload,
  type IntegrationContext,
} from '../helpers/integration.js';

describe('IT-2.10 Notifications', () => {
  let ctx: IntegrationContext;

  beforeAll(async () => {
    ctx = await setupIntegrationContext();
  });

  afterAll(async () => {
    await teardownIntegrationContext(ctx);
  });

  it('creates workflow notifications with snapshot email in payload', async () => {
    const employeeToken = ctx.token('employee', { sub: 'alice', employeeId: ctx.aliceId });
    const createRes = await ctx.app.inject({
      method: 'POST',
      url: '/api/v1/leave-requests',
      headers: authHeaders(employeeToken),
      payload: leaveRequestPayload(ctx.aliceId, ctx.leaveTypeId, {
        startDate: '2033-07-11',
        endDate: '2033-07-12',
        submit: true,
        dimensions: { locationId: 'US-NY' },
      }),
    });
    expect(createRes.statusCode).toBe(201);
    const requestId = createRes.json().data.id;

    const submitted = await ctx.prisma.notification.findFirst({
      where: { type: 'REQUEST_SUBMITTED', recipientEmployeeId: ctx.aliceId },
    });
    expect(submitted).toBeTruthy();
    expect((submitted!.payload as Record<string, unknown>).email).toBe('alice.employee@example.com');

    const managerToken = ctx.token('manager', { sub: 'bob', employeeId: ctx.bobId });
    const approveRes = await ctx.app.inject({
      method: 'POST',
      url: `/api/v1/leave-requests/${requestId}/approve`,
      headers: authHeaders(managerToken),
      payload: { data: { type: 'approvals', attributes: {} } },
    });
    expect(approveRes.statusCode).toBe(200);

    const approved = await ctx.prisma.notification.findFirst({
      where: { type: 'REQUEST_APPROVED', recipientEmployeeId: ctx.aliceId },
    });
    expect(approved).toBeTruthy();

    const rejectCreate = await ctx.app.inject({
      method: 'POST',
      url: '/api/v1/leave-requests',
      headers: authHeaders(employeeToken),
      payload: leaveRequestPayload(ctx.aliceId, ctx.leaveTypeId, {
        startDate: '2033-09-05',
        endDate: '2033-09-06',
        submit: true,
        dimensions: { locationId: 'US-NY' },
      }),
    });
    expect(rejectCreate.statusCode).toBe(201);
    const rejectId = rejectCreate.json().data.id;

    const rejectRes = await ctx.app.inject({
      method: 'POST',
      url: `/api/v1/leave-requests/${rejectId}/reject`,
      headers: authHeaders(managerToken),
      payload: { data: { type: 'approvals', attributes: { comment: 'no' } } },
    });
    expect(rejectRes.statusCode).toBe(200);

    const rejected = await ctx.prisma.notification.findFirst({
      where: { type: 'REQUEST_REJECTED', recipientEmployeeId: ctx.aliceId },
    });
    expect(rejected).toBeTruthy();
  });
});
