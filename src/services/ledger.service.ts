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

export interface ConvertReservationParams {
  employeeId: string;
  leaveTypeId: string;
  dimensions: Record<string, unknown>;
  leaveRequestId: string;
  approvalId?: string;
  durationDays: Decimal;
  hcmReferenceId?: string;
  usageEffectiveAt: Date;
}

/** Release pending reservation and record confirmed usage (spec: convert on approve). */
export async function convertPendingReservationToConfirmedUsage(
  prisma: PrismaClient,
  params: ConvertReservationParams,
) {
  await appendLedgerEntry(prisma, {
    employeeId: params.employeeId,
    leaveTypeId: params.leaveTypeId,
    dimensions: params.dimensions,
    entryType: 'RESERVATION_RELEASE',
    amount: params.durationDays,
    source: 'WORKFLOW',
    leaveRequestId: params.leaveRequestId,
    approvalId: params.approvalId,
    idempotencyKey: `reservation-release:${params.leaveRequestId}:approve`,
    effectiveAt: new Date(),
  });

  await appendLedgerEntry(prisma, {
    employeeId: params.employeeId,
    leaveTypeId: params.leaveTypeId,
    dimensions: params.dimensions,
    entryType: 'CONFIRMED_USAGE',
    amount: params.durationDays.negated(),
    source: 'WORKFLOW',
    leaveRequestId: params.leaveRequestId,
    approvalId: params.approvalId,
    hcmReferenceId: params.hcmReferenceId,
    idempotencyKey: `confirmed-usage:${params.leaveRequestId}`,
    effectiveAt: params.usageEffectiveAt,
  });
}

export async function pendingBalance(
  prisma: PrismaClient,
  employeeId: string,
  leaveTypeId: string,
  dimHash: string,
): Promise<Decimal> {
  const inFlightStatuses = ['PENDING', 'APPROVED_PENDING_HCM_UPDATE'] as const;

  const inFlightRequests = await prisma.leaveRequest.findMany({
    where: {
      employeeId,
      leaveTypeId,
      status: { in: [...inFlightStatuses] },
    },
    select: { id: true, dimensions: true },
  });

  const inFlightIds = inFlightRequests
    .filter((r) => dimensionsHash(r.dimensions as Record<string, unknown>) === dimHash)
    .map((r) => r.id);
  if (inFlightIds.length === 0) return new Decimal(0);

  const [reservations, releases] = await Promise.all([
    prisma.leaveBalanceLedger.findMany({
      where: {
        employeeId,
        leaveTypeId,
        dimensionsHash: dimHash,
        entryType: 'PENDING_RESERVATION',
        leaveRequestId: { in: inFlightIds },
      },
      select: { amount: true },
    }),
    prisma.leaveBalanceLedger.findMany({
      where: {
        employeeId,
        leaveTypeId,
        dimensionsHash: dimHash,
        entryType: 'RESERVATION_RELEASE',
        leaveRequestId: { in: inFlightIds },
      },
      select: { amount: true },
    }),
  ]);

  const reserved = reservations.reduce((s, r) => s.plus(r.amount.toString()), new Decimal(0));
  const released = releases.reduce((s, r) => s.plus(r.amount.toString()), new Decimal(0));
  return reserved.plus(released);
}

function isUniqueConstraint(err: unknown): boolean {
  return typeof err === 'object' && err !== null && 'code' in err && (err as { code: string }).code === 'P2002';
}

export { dimensionsHash };
