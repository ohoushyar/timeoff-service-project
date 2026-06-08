import { expect } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type { PrismaClient } from '@prisma/client';
import { Decimal } from 'decimal.js';
import { buildTestApp, signToken, JSON_API } from './app.js';
import { setupTestDb, teardownTestDb, getTestDatabaseUrl } from './db.js';
import {
  startWorkdayMock,
  resetMockMetrics,
} from '../../tools/workday-mock/server.js';
import type { Role } from '../../src/auth/roles.js';
import { dimensionsHash } from '../../src/lib/dimensions.js';
import { toJsonValue } from '../../src/lib/json.js';

export { JSON_API };

export interface IntegrationContext {
  app: FastifyInstance;
  prisma: PrismaClient;
  mockServer: Awaited<ReturnType<typeof startWorkdayMock>>;
  aliceId: string;
  bobId: string;
  carolId: string;
  leaveTypeId: string;
  token: (role: Role, opts?: { sub?: string; employeeId?: string }) => string;
}

export async function setupIntegrationContext(mockPort = 4011): Promise<IntegrationContext> {
  const mockServer = await startWorkdayMock(mockPort);
  const prisma = await setupTestDb();
  const app = await buildTestApp(
    {
      DATABASE_URL: getTestDatabaseUrl(),
      WORKDAY_TENANT_HOSTNAME: `127.0.0.1:${mockPort}`,
    },
    prisma,
  );

  const adminToken = signToken(app, { sub: 'admin', roles: ['system_admin'] });
  const syncRes = await app.inject({
    method: 'POST',
    url: '/api/v1/sync/time-off',
    headers: { authorization: `Bearer ${adminToken}` },
  });
  if (syncRes.statusCode !== 201) {
    throw new Error(`Sync bootstrap failed: ${syncRes.statusCode} ${syncRes.body}`);
  }

  const alice = await prisma.employeeHcmMapping.findUniqueOrThrow({
    where: { externalEmployeeId: 'worker-alice-wid' },
  });
  const bob = await prisma.employeeHcmMapping.findUniqueOrThrow({
    where: { externalEmployeeId: 'worker-bob-wid' },
  });
  const carol = await prisma.employeeHcmMapping.findUniqueOrThrow({
    where: { externalEmployeeId: 'worker-carol-wid' },
  });
  const leaveType = await prisma.leaveType.findFirstOrThrow();

  const token = (role: Role, opts?: { sub?: string; employeeId?: string }) =>
    signToken(app, {
      sub: opts?.sub ?? role,
      roles: [role],
      employeeId: opts?.employeeId,
    });

  return {
    app,
    prisma,
    mockServer,
    aliceId: alice.id,
    bobId: bob.id,
    carolId: carol.id,
    leaveTypeId: leaveType.id,
    token,
  };
}

export async function teardownIntegrationContext(ctx: IntegrationContext): Promise<void> {
  resetMockMetrics();
  await ctx.app.close();
  await ctx.mockServer.close();
  await teardownTestDb(ctx.prisma);
}

export function leaveRequestPayload(
  employeeId: string,
  leaveTypeId: string,
  attrs: Record<string, unknown>,
) {
  return {
    data: {
      type: 'leave-requests',
      attributes: attrs,
      relationships: {
        employee: { data: { type: 'employees', id: employeeId } },
        leaveType: { data: { type: 'leave-types', id: leaveTypeId } },
      },
    },
  };
}

export function authHeaders(token: string, contentType = JSON_API): Record<string, string> {
  return {
    authorization: `Bearer ${token}`,
    accept: JSON_API,
    ...(contentType ? { 'content-type': contentType } : {}),
  };
}

export function idempotencyHeaders(
  token: string,
  idempotencyKey: string,
  contentType = JSON_API,
): Record<string, string> {
  return {
    ...authHeaders(token, contentType),
    'idempotency-key': idempotencyKey,
  };
}

export function assertJsonApi(res: { json: () => unknown; statusCode: number }) {
  const body = res.json() as { jsonapi?: { version: string } };
  expect(body.jsonapi?.version).toBe('1.1');
}

/** Seeds APPROVED_PENDING_HCM_UPDATE state for fast retry-job tests (no HTTP workflow). */
export async function seedHcmPendingRequest(
  prisma: PrismaClient,
  opts: {
    employeeId: string;
    leaveTypeId: string;
    approverEmployeeId: string;
    startDate: string;
    endDate: string;
    durationDays: number;
    hcmRetryDeadlineAt: Date;
    hcmRetryCount?: number;
    dimensions?: Record<string, unknown>;
  },
): Promise<{ requestId: string; approvalId: string }> {
  const dimensions = opts.dimensions ?? { locationId: 'US-NY' };
  const hash = dimensionsHash(dimensions);
  const start = new Date(opts.startDate);
  const end = new Date(opts.endDate);
  const duration = new Decimal(opts.durationDays);

  const request = await prisma.leaveRequest.create({
    data: {
      employeeId: opts.employeeId,
      leaveTypeId: opts.leaveTypeId,
      startDate: start,
      endDate: end,
      durationDays: duration,
      dimensions: toJsonValue(dimensions),
      status: 'APPROVED_PENDING_HCM_UPDATE',
      submittedAt: new Date(Date.now() - 86_400_000),
      hcmRetryStartedAt: new Date(Date.now() - 86_400_000),
      hcmRetryDeadlineAt: opts.hcmRetryDeadlineAt,
      hcmRetryCount: opts.hcmRetryCount ?? 1,
    },
  });

  const approval = await prisma.approval.create({
    data: {
      leaveRequestId: request.id,
      approverEmployeeId: opts.approverEmployeeId,
      approvalLevel: 1,
      decision: 'APPROVED',
      decidedAt: new Date(),
    },
  });

  await prisma.leaveBalanceLedger.create({
    data: {
      employeeId: opts.employeeId,
      leaveTypeId: opts.leaveTypeId,
      dimensions: toJsonValue(dimensions),
      dimensionsHash: hash,
      entryType: 'PENDING_RESERVATION',
      amount: duration.negated(),
      source: 'WORKFLOW',
      leaveRequestId: request.id,
      idempotencyKey: `pending-reservation:${request.id}`,
      effectiveAt: start,
    },
  });

  return { requestId: request.id, approvalId: approval.id };
}

// re-export expect for helper modules that need it in assertJsonApi - tests import expect from vitest
