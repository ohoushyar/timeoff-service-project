import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { buildTestApp, signToken, JSON_API } from '../helpers/app.js';
import { setupTestDb, teardownTestDb, getTestDatabaseUrl } from '../helpers/db.js';
import type { FastifyInstance } from 'fastify';
import type { PrismaClient } from '@prisma/client';
import {
  buildWorkdayMockApp,
  startWorkdayMock,
} from '../../tools/workday-mock/server.js';

describe('integration: health and auth', () => {
  let app: FastifyInstance;
  let prisma: PrismaClient;

  beforeAll(async () => {
    prisma = await setupTestDb();
    app = await buildTestApp({ DATABASE_URL: getTestDatabaseUrl() }, prisma);
  });

  afterAll(async () => {
    await app.close();
    await teardownTestDb(prisma);
  });

  it('GET /health/live returns 200', async () => {
    const res = await app.inject({ method: 'GET', url: '/health/live' });
    expect(res.statusCode).toBe(200);
  });

  it('GET /health/ready returns 200 when DB up', async () => {
    const res = await app.inject({ method: 'GET', url: '/health/ready' });
    expect(res.statusCode).toBe(200);
  });

  it('protected route returns 401 without JWT', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/leave-types' });
    expect(res.statusCode).toBe(401);
  });

  it('returns JSON:API error shape', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/leave-types' });
    const body = res.json();
    expect(body.errors).toBeDefined();
    expect(body.jsonapi.version).toBe('1.1');
  });
});

describe('integration: sync and workflow', () => {
  let app: FastifyInstance;
  let prisma: PrismaClient;
  let mockServer: ReturnType<typeof buildWorkdayMockApp>;
  let aliceId: string;
  let bobId: string;
  let leaveTypeId: string;

  beforeAll(async () => {
    mockServer = await startWorkdayMock(4010);
    prisma = await setupTestDb();
    app = await buildTestApp(
      {
        DATABASE_URL: getTestDatabaseUrl(),
        WORKDAY_TENANT_HOSTNAME: '127.0.0.1:4010',
      },
      prisma,
    );

    const adminToken = signToken(app, {
      sub: 'admin',
      roles: ['system_admin'],
      employeeId: undefined,
    });

    await app.inject({
      method: 'POST',
      url: '/api/v1/sync/time-off',
      headers: { authorization: `Bearer ${adminToken}` },
    });

    const alice = await prisma.employeeHcmMapping.findUnique({
      where: { externalEmployeeId: 'worker-alice-wid' },
    });
    const bob = await prisma.employeeHcmMapping.findUnique({
      where: { externalEmployeeId: 'worker-bob-wid' },
    });
    const lt = await prisma.leaveType.findFirst();
    aliceId = alice!.id;
    bobId = bob!.id;
    leaveTypeId = lt!.id;
  }, 60000);

  afterAll(async () => {
    await app.close();
    await mockServer.close();
    await teardownTestDb(prisma);
  });

  it('submit creates PENDING without HCM write', async () => {
    const token = signToken(app, { sub: 'alice', roles: ['employee'], employeeId: aliceId });
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/leave-requests',
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': JSON_API,
      },
      payload: {
        data: {
          type: 'leave-requests',
          attributes: {
            startDate: '2026-08-04',
            endDate: '2026-08-06',
            submit: true,
            dimensions: { locationId: 'US-NY' },
          },
          relationships: {
            employee: { data: { type: 'employees', id: aliceId } },
            leaveType: { data: { type: 'leave-types', id: leaveTypeId } },
          },
        },
      },
    });
    expect(res.statusCode).toBe(201);
    expect(res.json().data.attributes.status).toBe('PENDING');

    const ledger = await prisma.leaveBalanceLedger.findFirst({
      where: { entryType: 'PENDING_RESERVATION' },
    });
    expect(ledger).toBeTruthy();
  });

  it('approve transitions to APPROVED with HCM reference', async () => {
    const request = await prisma.leaveRequest.findFirst({ where: { status: 'PENDING' } });
    const token = signToken(app, { sub: 'bob', roles: ['manager'], employeeId: bobId });
    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/leave-requests/${request!.id}/approve`,
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': JSON_API,
      },
      payload: { data: { type: 'approvals', attributes: { comment: 'OK' } } },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().data.attributes.status).toBe('APPROVED');
    expect(res.json().data.attributes.hcmReferenceId).toBeTruthy();
  });

  it('audit logs exclude email', async () => {
    const logs = await prisma.auditLog.findMany();
    for (const log of logs) {
      const serialized = JSON.stringify(log);
      expect(serialized).not.toContain('alice@example.com');
      expect(serialized).not.toContain('bob@example.com');
    }
  });
});
