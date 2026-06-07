import type { PrismaClient } from '@prisma/client';
import { AppError } from '../errors/app-error.js';
import type { HcmClient } from '../integrations/hcm/types.js';
import { dimensionsHash } from '../lib/dimensions.js';
import { reconcileBalanceKey } from './balance-sync.service.js';
import { writeAudit } from './audit.service.js';
import { toJsonValue } from '../lib/json.js';
import { Decimal } from 'decimal.js';

export interface SyncResult {
  syncRunId: string;
  employeeCount: number;
  balanceCount: number;
  adjustmentCount: number;
  status: 'SUCCESS' | 'PARTIAL' | 'FAILED';
}

export async function runTimeOffSync(
  prisma: PrismaClient,
  hcm: HcmClient,
  options: { syncType?: string; correlationId: string; actorId?: string; actorRole?: string },
): Promise<SyncResult> {
  const syncState = await prisma.timeOffSyncState.findFirst();
  if (syncState?.syncInProgress) {
    throw new AppError('SYNC_IN_PROGRESS');
  }

  if (syncState) {
    await prisma.timeOffSyncState.update({
      where: { id: syncState.id },
      data: { syncInProgress: true, lastSyncStartedAt: new Date(), lastSyncStatus: 'IN_PROGRESS' },
    });
  } else {
    await prisma.timeOffSyncState.create({
      data: {
        syncSource: 'hcm-rest',
        syncInProgress: true,
        lastSyncStartedAt: new Date(),
        lastSyncStatus: 'IN_PROGRESS',
      },
    });
  }

  const syncRun = await prisma.syncRun.create({
    data: {
      syncType: options.syncType ?? 'nightly',
      status: 'IN_PROGRESS',
      correlationId: options.correlationId,
      startedAt: new Date(),
    },
  });

  let employeeCount = 0;
  let balanceCount = 0;
  let adjustmentCount = 0;
  let status: SyncResult['status'] = 'SUCCESS';
  const syncedExternalIds = new Set<string>();

  try {
    let offset = 0;
    const limit = 100;
    let hasMore = true;

    while (hasMore) {
      const page = await hcm.fetchEmployeeSnapshots({ offset, limit, correlationId: options.correlationId });
      for (const snap of page.data) {
        syncedExternalIds.add(snap.externalEmployeeId);
        await prisma.employeeHcmMapping.upsert({
          where: { externalEmployeeId: snap.externalEmployeeId },
          create: {
            externalEmployeeId: snap.externalEmployeeId,
            email: snap.email,
            managerExternalEmployeeId: snap.managerExternalEmployeeId,
            department: snap.department,
            employmentStatus: snap.employmentStatus,
            syncCorrelationKey: options.correlationId,
            lastSyncedAt: new Date(),
          },
          update: {
            email: snap.email,
            managerExternalEmployeeId: snap.managerExternalEmployeeId,
            department: snap.department,
            employmentStatus: snap.employmentStatus,
            syncCorrelationKey: options.correlationId,
            lastSyncedAt: new Date(),
          },
        });
        employeeCount++;
      }
      hasMore = page.hasMore;
      offset += limit;
    }

    // Resolve manager FK
    const employees = await prisma.employeeHcmMapping.findMany();
    for (const emp of employees) {
      if (emp.managerExternalEmployeeId) {
        const manager = await prisma.employeeHcmMapping.findUnique({
          where: { externalEmployeeId: emp.managerExternalEmployeeId },
        });
        if (manager && emp.managerId !== manager.id) {
          await prisma.employeeHcmMapping.update({
            where: { id: emp.id },
            data: { managerId: manager.id },
          });
        }
      }
    }

    const effectiveDate = new Date().toISOString().slice(0, 10);
    for (const emp of await prisma.employeeHcmMapping.findMany()) {
      const leaveTypes = await hcm.fetchEligibleAbsenceTypes(emp.externalEmployeeId);
      for (const lt of leaveTypes) {
        const leaveType = await prisma.leaveType.upsert({
          where: { externalLeaveTypeId: lt.externalLeaveTypeId },
          create: {
            externalLeaveTypeId: lt.externalLeaveTypeId,
            code: lt.code,
            name: lt.name,
            description: lt.description,
            isPaid: lt.isPaid ?? true,
            requiresApproval: lt.requiresApproval ?? true,
            requiresDocumentation: lt.requiresDocumentation ?? false,
            allowPartialDay: lt.allowPartialDay ?? true,
            lastSyncedAt: new Date(),
          },
          update: {
            name: lt.name,
            description: lt.description,
            isPaid: lt.isPaid ?? true,
            requiresApproval: lt.requiresApproval ?? true,
            lastSyncedAt: new Date(),
          },
        });

        const policies = await hcm.fetchPolicies(emp.externalEmployeeId, [lt]);
        for (const pol of policies) {
          const policy = await prisma.leavePolicy.upsert({
            where: { externalPolicyId: pol.externalPolicyId },
            create: {
              externalPolicyId: pol.externalPolicyId,
              leaveTypeId: leaveType.id,
              name: pol.name,
              effectiveFrom: new Date(pol.effectiveFrom),
              effectiveTo: pol.effectiveTo ? new Date(pol.effectiveTo) : null,
              location: pol.location,
              department: pol.department,
              employmentType: pol.employmentType,
              minTenureDays: pol.minTenureDays,
              lastSyncedAt: new Date(),
            },
            update: {
              name: pol.name,
              effectiveFrom: new Date(pol.effectiveFrom),
              lastSyncedAt: new Date(),
            },
          });

          await prisma.leavePolicyRule.deleteMany({ where: { policyId: policy.id } });
          for (const rule of pol.rules) {
            await prisma.leavePolicyRule.create({
              data: {
                policyId: policy.id,
                ruleType: rule.ruleType,
                config: toJsonValue(rule.config),
                priority: rule.priority ?? 0,
              },
            });
          }
        }
      }

      const balanceRows = await hcm.fetchBalances(emp.externalEmployeeId, effectiveDate);
      for (const row of balanceRows) {
        const leaveType = await prisma.leaveType.findUnique({
          where: { externalLeaveTypeId: row.externalLeaveTypeId },
        });
        if (!leaveType) continue;

        const hash = dimensionsHash(row.dimensions);
        await prisma.leaveBalance.upsert({
          where: {
            employeeId_leaveTypeId_dimensionsHash: {
              employeeId: emp.id,
              leaveTypeId: leaveType.id,
              dimensionsHash: hash,
            },
          },
          create: {
            employeeId: emp.id,
            leaveTypeId: leaveType.id,
            dimensions: toJsonValue(row.dimensions),
            dimensionsHash: hash,
            currentBalance: row.currentBalance,
            unit: row.unit,
            lastSyncedAt: new Date(),
            hcmUpdatedAt: row.hcmUpdatedAt ? new Date(row.hcmUpdatedAt) : null,
          },
          update: {
            currentBalance: row.currentBalance,
            lastSyncedAt: new Date(),
            hcmUpdatedAt: row.hcmUpdatedAt ? new Date(row.hcmUpdatedAt) : null,
          },
        });
        balanceCount++;

        const adjusted = await reconcileBalanceKey(prisma, {
          syncRunId: syncRun.id,
          employeeId: emp.id,
          leaveTypeId: leaveType.id,
          dimensions: row.dimensions,
          dimensionsHash: hash,
          hcmCurrentBalance: new Decimal(row.currentBalance),
        });
        if (adjusted) adjustmentCount++;
      }
    }

    // Mark absent workers inactive
    await prisma.employeeHcmMapping.updateMany({
      where: {
        externalEmployeeId: { notIn: [...syncedExternalIds] },
        employmentStatus: 'ACTIVE',
      },
      data: { employmentStatus: 'INACTIVE' },
    });

    const state = await prisma.timeOffSyncState.findFirst();
    if (state) {
      await prisma.timeOffSyncState.update({
        where: { id: state.id },
        data: {
          syncInProgress: false,
          lastSyncCompletedAt: new Date(),
          lastSyncStatus: status,
        },
      });
    }

    await prisma.syncRun.update({
      where: { id: syncRun.id },
      data: {
        status,
        completedAt: new Date(),
        employeeCount,
        balanceCount,
        adjustmentCount,
      },
    });

    await writeAudit(prisma, {
      action: 'SYNC_OPERATION',
      actorId: options.actorId,
      actorRole: options.actorRole,
      resourceType: 'sync-runs',
      resourceId: syncRun.id,
      correlationId: options.correlationId,
      after: { employeeCount, balanceCount, adjustmentCount, status },
    });
  } catch (err) {
    status = 'FAILED';
    await prisma.syncRun.update({
      where: { id: syncRun.id },
      data: {
        status: 'FAILED',
        completedAt: new Date(),
        errorDetails: { message: err instanceof Error ? err.message : String(err) },
      },
    });
    const state = await prisma.timeOffSyncState.findFirst();
    if (state) {
      await prisma.timeOffSyncState.update({
        where: { id: state.id },
        data: { syncInProgress: false, lastSyncStatus: 'FAILED' },
      });
    }
    throw err;
  }

  return { syncRunId: syncRun.id, employeeCount, balanceCount, adjustmentCount, status };
}

export async function getSyncStatus(prisma: PrismaClient) {
  const state = await prisma.timeOffSyncState.findFirst();
  const lastRun = await prisma.syncRun.findFirst({ orderBy: { startedAt: 'desc' } });
  const stalenessSeconds = state?.lastSyncCompletedAt
    ? Math.floor((Date.now() - state.lastSyncCompletedAt.getTime()) / 1000)
    : undefined;

  return {
    syncSource: state?.syncSource ?? 'hcm-rest',
    lastSyncStartedAt: state?.lastSyncStartedAt?.toISOString(),
    lastSyncCompletedAt: state?.lastSyncCompletedAt?.toISOString(),
    lastSyncStatus: state?.lastSyncStatus ?? 'IN_PROGRESS',
    employeeCount: lastRun?.employeeCount ?? undefined,
    balanceCount: lastRun?.balanceCount ?? undefined,
    stalenessSeconds,
  };
}
