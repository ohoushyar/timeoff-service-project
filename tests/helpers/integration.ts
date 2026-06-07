import { expect } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type { PrismaClient } from '@prisma/client';
import { buildTestApp, signToken, JSON_API } from './app.js';
import { setupTestDb, teardownTestDb, getTestDatabaseUrl } from './db.js';
import {
  startWorkdayMock,
  resetMockMetrics,
} from '../../tools/workday-mock/server.js';
import type { Role } from '../../src/auth/roles.js';

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

export function assertJsonApi(res: { json: () => unknown; statusCode: number }) {
  const body = res.json() as { jsonapi?: { version: string } };
  expect(body.jsonapi?.version).toBe('1.1');
}

// re-export expect for helper modules that need it in assertJsonApi - tests import expect from vitest
