import { Decimal } from 'decimal.js';
import type { PrismaClient } from '@prisma/client';
import { appendLedgerEntry, sumLedgerBalance } from './ledger.service.js';

export async function reconcileBalanceKey(
  prisma: PrismaClient,
  params: {
    syncRunId: string;
    employeeId: string;
    leaveTypeId: string;
    dimensions: Record<string, unknown>;
    dimensionsHash: string;
    hcmCurrentBalance: Decimal;
  },
): Promise<boolean> {
  const ledgerBalance = await sumLedgerBalance(
    prisma,
    params.employeeId,
    params.leaveTypeId,
    params.dimensionsHash,
  );

  const drift = params.hcmCurrentBalance.minus(ledgerBalance);
  if (drift.isZero()) return false;

  const idempotencyKey = `sync-adjustment:${params.syncRunId}:${params.employeeId}:${params.leaveTypeId}:${params.dimensionsHash}`;

  await appendLedgerEntry(prisma, {
    employeeId: params.employeeId,
    leaveTypeId: params.leaveTypeId,
    dimensions: params.dimensions,
    entryType: 'SYNC_ADJUSTMENT',
    amount: drift,
    source: 'HCM_NIGHTLY_RECONCILIATION',
    syncRunId: params.syncRunId,
    idempotencyKey,
    effectiveAt: new Date(),
  });
  return true;
}
