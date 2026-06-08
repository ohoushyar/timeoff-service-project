import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createNotification } from '../../../src/services/notification.service.js';
import { setupTestDb, teardownTestDb } from '../../helpers/db.js';
import type { PrismaClient } from '@prisma/client';

describe('notification.service', () => {
  let prisma: PrismaClient;

  beforeEach(async () => {
    prisma = await setupTestDb();
    await prisma.employeeHcmMapping.create({
      data: {
        id: 'emp-1',
        externalEmployeeId: 'ext-1',
        email: 'user@example.com',
        employmentStatus: 'ACTIVE',
        lastSyncedAt: new Date(),
      },
    });
  });

  afterEach(async () => {
    await teardownTestDb(prisma);
  });

  it('stores snapshot email in notification payload', async () => {
    await createNotification(prisma, {
      type: 'REQUEST_SUBMITTED',
      recipientEmployeeId: 'emp-1',
      payload: { leaveRequestId: 'lr-1' },
    });

    const row = await prisma.notification.findFirstOrThrow();
    expect((row.payload as Record<string, unknown>).email).toBe('user@example.com');
    expect((row.payload as Record<string, unknown>).leaveRequestId).toBe('lr-1');
  });
});
