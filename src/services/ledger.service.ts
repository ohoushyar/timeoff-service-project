import { Decimal } from 'decimal.js';
import type { PrismaClient, LedgerEntryType, LedgerEntrySource } from '@prisma/client';
import { AppError } from '../errors/app-error.js';
import { dimensionsHash } from '../lib/dimensions.js';
import { toJsonValue } from '../lib/json.js';

export interface AppendLedgerEntryParams {
  employeeId: string;
  leaveTypeId: string;
  dimensions: Record<string, unknown>;
  entryType: LedgerEntryType;
  amount: Decimal | number;
  source: LedgerEntrySource;
  leaveRequestId?: string;
  approvalId?: string;
  hcmReferenceId?: string;
  syncRunId?: string;
  idempotencyKey?: string;
  effectiveAt: Date;
}

export async function sumLedgerBalance(
  prisma: PrismaClient,
  employeeId: string,
  leaveTypeId: string,
  dimHash: string,
): Promise<Decimal> {
  const entries = await prisma.leaveBalanceLedger.findMany({
    where: { employeeId, leaveTypeId, dimensionsHash: dimHash },
    select: { amount: true },
  });
  return entries.reduce((sum, e) => sum.plus(e.amount.toString()), new Decimal(0));
}

export async function appendLedgerEntry(
  prisma: PrismaClient,
  params: AppendLedgerEntryParams,
) {
  const hash = dimensionsHash(params.dimensions);
  const amount = new Decimal(params.amount);

  if (params.idempotencyKey) {
    const existing = await prisma.leaveBalanceLedger.findUnique({
      where: { idempotencyKey: params.idempotencyKey },
    });
    if (existing) return existing;
  }

  try {
    return await prisma.leaveBalanceLedger.create({
      data: {
        employeeId: params.employeeId,
        leaveTypeId: params.leaveTypeId,
        dimensions: toJsonValue(params.dimensions),
        dimensionsHash: hash,
        entryType: params.entryType,
        amount,
        source: params.source,
        leaveRequestId: params.leaveRequestId,
        approvalId: params.approvalId,
        hcmReferenceId: params.hcmReferenceId,
        syncRunId: params.syncRunId,
        idempotencyKey: params.idempotencyKey,
        effectiveAt: params.effectiveAt,
      },
    });
  } catch (err) {
    if (params.idempotencyKey && isUniqueConstraint(err)) {
      const existing = await prisma.leaveBalanceLedger.findUnique({
        where: { idempotencyKey: params.idempotencyKey },
      });
      if (existing) return existing;
    }
    throw err;
  }
}

export async function pendingBalance(
  prisma: PrismaClient,
  employeeId: string,
  leaveTypeId: string,
  dimHash: string,
): Promise<Decimal> {
  const inFlightStatuses = ['PENDING', 'APPROVED_PENDING_HCM_UPDATE'] as const;

  const reservations = await prisma.leaveBalanceLedger.findMany({
    where: {
      employeeId,
      leaveTypeId,
      dimensionsHash: dimHash,
      entryType: 'PENDING_RESERVATION',
      leaveRequest: { status: { in: [...inFlightStatuses] } },
    },
    select: { amount: true, leaveRequestId: true },
  });

  const releases = await prisma.leaveBalanceLedger.findMany({
    where: {
      employeeId,
      leaveTypeId,
      dimensionsHash: dimHash,
      entryType: 'RESERVATION_RELEASE',
    },
    select: { amount: true, leaveRequestId: true },
  });

  const reserved = reservations.reduce((s, r) => s.plus(r.amount.toString()), new Decimal(0));
  const released = releases.reduce((s, r) => s.plus(r.amount.toString()), new Decimal(0));
  return reserved.plus(released);
}

function isUniqueConstraint(err: unknown): boolean {
  return typeof err === 'object' && err !== null && 'code' in err && (err as { code: string }).code === 'P2002';
}

export { dimensionsHash };
