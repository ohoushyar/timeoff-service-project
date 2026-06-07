import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Decimal } from 'decimal.js';
import { setupTestDb, teardownTestDb } from '../../helpers/db';
import type { PrismaClient } from '@prisma/client';
import { dimensionsHash, sumLedgerBalance, appendLedgerEntry, pendingBalance } from '../../../src/services/ledger.service';

describe('ledger.service', () => {
  let prisma: PrismaClient;
  let employeeId: string;
  let leaveTypeId: string;

  beforeAll(async () => {
    prisma = await setupTestDb();
    const emp = await prisma.employeeHcmMapping.create({
      data: {
        externalEmployeeId: 'wid-1',
        email: 'e@example.com',
        employmentStatus: 'ACTIVE',
        lastSyncedAt: new Date(),
      },
    });
    employeeId = emp.id;
    const lt = await prisma.leaveType.create({
      data: {
        externalLeaveTypeId: 'lt-ext',
        code: 'vacation',
        name: 'Vacation',
      },
    });
    leaveTypeId = lt.id;
  });

  afterAll(async () => teardownTestDb(prisma));

  it('sumLedgerBalance aggregates entries', async () => {
    const dims = { locationId: 'US-NY' };
    await appendLedgerEntry(prisma, {
      employeeId,
      leaveTypeId,
      dimensions: dims,
      entryType: 'OPENING_BALANCE',
      amount: 10,
      source: 'HCM_NIGHTLY_RECONCILIATION',
      effectiveAt: new Date(),
      idempotencyKey: 'open-1',
    });
    const sum = await sumLedgerBalance(prisma, employeeId, leaveTypeId, dimensionsHash(dims));
    expect(sum.toNumber()).toBe(10);
  });

  it('appendLedgerEntry is idempotent', async () => {
    const dims = { locationId: 'US-NY' };
    const key = 'idem-1';
    await appendLedgerEntry(prisma, {
      employeeId,
      leaveTypeId,
      dimensions: dims,
      entryType: 'SYNC_ADJUSTMENT',
      amount: 1,
      source: 'HCM_NIGHTLY_RECONCILIATION',
      effectiveAt: new Date(),
      idempotencyKey: key,
    });
    const second = await appendLedgerEntry(prisma, {
      employeeId,
      leaveTypeId,
      dimensions: dims,
      entryType: 'SYNC_ADJUSTMENT',
      amount: 1,
      source: 'HCM_NIGHTLY_RECONCILIATION',
      effectiveAt: new Date(),
      idempotencyKey: key,
    });
    const count = await prisma.leaveBalanceLedger.count({ where: { idempotencyKey: key } });
    expect(count).toBe(1);
    expect(second.id).toBeDefined();
  });
});
