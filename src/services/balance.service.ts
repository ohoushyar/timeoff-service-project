import { Decimal } from 'decimal.js';
import type { PrismaClient } from '@prisma/client';
import type { HcmClient } from '../integrations/hcm/types.js';
import { HcmUnavailableError } from '../integrations/hcm/types.js';
import { dimensionsHash, sumLedgerBalance, pendingBalance } from './ledger.service.js';
import type { BalanceView } from '../serializers/jsonapi/resources/balances.js';

export async function getEmployeeBalances(
  prisma: PrismaClient,
  hcm: HcmClient,
  employeeId: string,
  options?: { refreshFromHcm?: boolean; effectiveDate?: string },
): Promise<BalanceView[]> {
  const employee = await prisma.employeeHcmMapping.findUnique({ where: { id: employeeId } });
  if (!employee) return [];

  const balances = await prisma.leaveBalance.findMany({
    where: { employeeId },
    include: { leaveType: true },
  });

  const effectiveDate = options?.effectiveDate ?? new Date().toISOString().slice(0, 10);
  let hcmBalances: Map<string, number> | null = null;

  if (options?.refreshFromHcm) {
    try {
      const rows = await hcm.fetchBalances(employee.externalEmployeeId, effectiveDate);
      hcmBalances = new Map(
        rows.map((r) => [`${r.externalLeaveTypeId}:${dimensionsHash(r.dimensions)}`, r.currentBalance]),
      );
    } catch (err) {
      if (!(err instanceof HcmUnavailableError)) throw err;
    }
  }

  const views: BalanceView[] = [];
  for (const bal of balances) {
    const dims = bal.dimensions as Record<string, unknown>;
    const hash = bal.dimensionsHash;
    let currentBalance = new Decimal(bal.currentBalance.toString());

    if (hcmBalances) {
      const key = `${bal.leaveType.externalLeaveTypeId}:${hash}`;
      const refreshed = hcmBalances.get(key);
      if (refreshed !== undefined) {
        currentBalance = new Decimal(refreshed);
        await prisma.leaveBalance.update({
          where: { id: bal.id },
          data: { currentBalance: refreshed, lastSyncedAt: new Date() },
        });
      }
    }

    const ledgerBalance = await sumLedgerBalance(prisma, employeeId, bal.leaveTypeId, hash);
    const pending = await pendingBalance(prisma, employeeId, bal.leaveTypeId, hash);
    const availableBalance = ledgerBalance.minus(pending);

    views.push({
      id: bal.id,
      employeeId,
      leaveTypeId: bal.leaveTypeId,
      dimensions: dims,
      currentBalance: currentBalance.toNumber(),
      ledgerBalance: ledgerBalance.toNumber(),
      pendingBalance: pending.abs().toNumber(),
      availableBalance: availableBalance.toNumber(),
      unit: bal.unit,
      lastSyncedAt: bal.lastSyncedAt?.toISOString(),
    });
  }
  return views;
}

export async function checkAvailableBalance(
  prisma: PrismaClient,
  employeeId: string,
  leaveTypeId: string,
  dimensions: Record<string, unknown>,
  durationDays: Decimal,
  allowsNegative: boolean,
): Promise<{ sufficient: boolean; available: Decimal }> {
  const hash = dimensionsHash(dimensions);
  const ledgerBalance = await sumLedgerBalance(prisma, employeeId, leaveTypeId, hash);
  const pending = await pendingBalance(prisma, employeeId, leaveTypeId, hash);
  const available = ledgerBalance.minus(pending);

  if (allowsNegative) return { sufficient: true, available };
  return { sufficient: available.gte(durationDays), available };
}
