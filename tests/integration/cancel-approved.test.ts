import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import {
  setupIntegrationContext,
  teardownIntegrationContext,
  authHeaders,
  leaveRequestPayload,
  type IntegrationContext,
} from '../helpers/integration.js';
import {
  resetMockMetrics,
  getCorrectTimeOffEntryCallCount,
} from '../../tools/workday-mock/server.js';

describe('IT-2.8 POST .../cancel (approved)', () => {
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

  it('calls correctTimeOffEntry and creates USAGE_REVERSAL ledger entry', async () => {
    const employeeToken = ctx.token('employee', { sub: 'alice', employeeId: ctx.aliceId });
    const createRes = await ctx.app.inject({
      method: 'POST',
      url: '/api/v1/leave-requests',
      headers: authHeaders(employeeToken),
      payload: leaveRequestPayload(ctx.aliceId, ctx.leaveTypeId, {
        startDate: '2031-05-12',
        endDate: '2031-05-14',
        submit: true,
        dimensions: { locationId: 'US-NY' },
      }),
    });
    expect(createRes.statusCode).toBe(201);
    const requestId = createRes.json().data.id;

    const managerToken = ctx.token('manager', { sub: 'bob', employeeId: ctx.bobId });
    const approveRes = await ctx.app.inject({
      method: 'POST',
      url: `/api/v1/leave-requests/${requestId}/approve`,
      headers: authHeaders(managerToken),
      payload: { data: { type: 'approvals', attributes: {} } },
    });
    expect(approveRes.statusCode).toBe(200);
    expect(approveRes.json().data.attributes.status).toBe('APPROVED');

    const cancelRes = await ctx.app.inject({
      method: 'POST',
      url: `/api/v1/leave-requests/${requestId}/cancel`,
      headers: authHeaders(employeeToken, ''),
    });
    expect(cancelRes.statusCode).toBe(200);
    expect(cancelRes.json().data.attributes.status).toBe('CANCELLED');
    expect(getCorrectTimeOffEntryCallCount()).toBe(1);

    const reversal = await ctx.prisma.leaveBalanceLedger.findFirst({
      where: { leaveRequestId: requestId, entryType: 'USAGE_REVERSAL' },
    });
    expect(reversal).toBeTruthy();
  });
});
