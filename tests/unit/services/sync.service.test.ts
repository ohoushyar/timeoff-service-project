import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { setupTestDb, teardownTestDb } from '../../helpers/db';
import type { PrismaClient } from '@prisma/client';
import { runTimeOffSync } from '../../../src/services/sync.service';
import type { HcmClient } from '../../../src/integrations/hcm/types';

const mockHcm: HcmClient = {
  fetchEmployeeSnapshots: async () => ({
    data: [
      {
        externalEmployeeId: 'worker-alice-wid',
        email: 'alice@example.com',
        managerExternalEmployeeId: 'worker-bob-wid',
        department: 'Engineering',
        employmentStatus: 'ACTIVE',
      },
      {
        externalEmployeeId: 'worker-bob-wid',
        email: 'bob@example.com',
        department: 'Engineering',
        employmentStatus: 'ACTIVE',
      },
    ],
    total: 2,
    hasMore: false,
  }),
  fetchEligibleAbsenceTypes: async () => [
    { externalLeaveTypeId: 'leave-vacation-wid', code: 'vacation', name: 'Vacation' },
  ],
  fetchPolicies: async (_w, lts) =>
    lts.map((lt) => ({
      externalPolicyId: `pol-${lt.externalLeaveTypeId}`,
      externalLeaveTypeId: lt.externalLeaveTypeId,
      name: 'Policy',
      effectiveFrom: '2020-01-01',
      rules: [{ ruleType: 'negative_balance', config: { allowed: false } }],
    })),
  fetchBalances: async () => [
    {
      externalLeaveTypeId: 'leave-vacation-wid',
      dimensions: { locationId: 'US-NY' },
      currentBalance: 10,
      unit: 'days',
    },
  ],
  requestTimeOff: async () => ({ hcmReferenceId: 'entry-1', days: [] }),
  correctTimeOffEntry: async () => {},
  getValidTimeOffDates: async (q) => ({ validDates: q.dates, invalidDates: [] }),
};

describe('sync.service', () => {
  let prisma: PrismaClient;

  beforeAll(async () => {
    prisma = await setupTestDb();
  });

  afterAll(async () => teardownTestDb(prisma));

  it('upserts employees and balances from HCM', async () => {
    const result = await runTimeOffSync(prisma, mockHcm, {
      syncType: 'bootstrap',
      correlationId: 'test-corr',
    });
    expect(result.employeeCount).toBe(2);
    expect(result.balanceCount).toBeGreaterThan(0);

    const alice = await prisma.employeeHcmMapping.findUnique({
      where: { externalEmployeeId: 'worker-alice-wid' },
    });
    expect(alice?.managerId).toBeTruthy();
  });

  it('blocks concurrent sync', async () => {
    await prisma.timeOffSyncState.deleteMany();
    await prisma.timeOffSyncState.create({
      data: { syncSource: 'hcm-rest', syncInProgress: true, lastSyncStatus: 'IN_PROGRESS' },
    });
    await expect(
      runTimeOffSync(prisma, mockHcm, { correlationId: 'c2' }),
    ).rejects.toMatchObject({ code: 'SYNC_IN_PROGRESS' });
  });
});
