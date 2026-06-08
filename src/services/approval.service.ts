import { Decimal } from 'decimal.js';
import type { PrismaClient } from '@prisma/client';
import { AppError } from '../errors/app-error.js';
import type { HcmClient } from '../integrations/hcm/types.js';
import { HcmUnavailableError, HcmValidationError } from '../integrations/hcm/types.js';
import { mapWorkdayErrorCode } from '../integrations/hcm/workday/error-mapping.js';
import type { Env } from '../config/env.js';
import { appendLedgerEntry } from './ledger.service.js';
import { checkAvailableBalance } from './balance.service.js';
import { writeAudit } from './audit.service.js';
import { notifyEmployee } from './notification.service.js';
import {
  resolvePolicy,
  allowsNegativeBalance,
  type PolicyWithRules,
} from './policy-engine.js';

export async function listPendingApprovals(
  prisma: PrismaClient,
  approverEmployeeId: string,
  page: number,
  pageSize: number,
) {
  const where = {
    approverEmployeeId,
    decision: 'PENDING' as const,
    leaveRequest: { status: 'PENDING' as const },
  };
  const [items, totalCount] = await Promise.all([
    prisma.approval.findMany({
      where,
      skip: (page - 1) * pageSize,
      take: pageSize,
      include: { leaveRequest: true },
      orderBy: { createdAt: 'asc' },
    }),
    prisma.approval.count({ where }),
  ]);
  return { items, totalCount };
}

export async function approveLeaveRequest(
  prisma: PrismaClient,
  hcm: HcmClient,
  env: Env,
  leaveRequestId: string,
  approverEmployeeId: string,
  comment?: string,
  actor?: { id?: string; role?: string; correlationId?: string },
) {
  const approval = await prisma.approval.findFirst({
    where: {
      leaveRequestId,
      approverEmployeeId,
      decision: 'PENDING',
    },
    include: {
      leaveRequest: {
        include: {
          employee: true,
          leaveType: true,
        },
      },
    },
  });

  if (!approval) {
    const inChain = await prisma.approval.findFirst({
      where: { leaveRequestId, approverEmployeeId },
    });
    if (!inChain) throw new AppError('FORBIDDEN');
    throw new AppError('APPROVAL_NOT_PENDING');
  }

  const request = approval.leaveRequest;
  if (request.status !== 'PENDING') {
    throw new AppError('INVALID_WORKFLOW_TRANSITION');
  }

  await prisma.approval.update({
    where: { id: approval.id },
    data: { decision: 'APPROVED', comment, decidedAt: new Date() },
  });

  const dimensions = request.dimensions as Record<string, unknown>;
  const policies = await prisma.leavePolicy.findMany({
    where: { leaveTypeId: request.leaveTypeId, isActive: true },
    include: { rules: true },
  });
  const location = dimensions.locationId as string | undefined;
  const policy = resolvePolicy(
    policies as PolicyWithRules[],
    request.employee,
    request.leaveTypeId,
    location,
  );
  const negativeAllowed = allowsNegativeBalance(policy);
  const durationDays = new Decimal(request.durationDays.toString());

  try {
    await hcm.fetchBalances(
      request.employee.externalEmployeeId,
      request.startDate.toISOString().slice(0, 10),
    );
  } catch (err) {
    if (!(err instanceof HcmUnavailableError)) throw err;
  }

  const { sufficient } = await checkAvailableBalance(
    prisma,
    request.employeeId,
    request.leaveTypeId,
    dimensions,
    durationDays,
    negativeAllowed,
  );
  if (!sufficient) throw new AppError('INSUFFICIENT_BALANCE');

  const days = buildTimeOffDays(request);
  try {
    const result = await hcm.requestTimeOff(request.employee.externalEmployeeId, {
      days,
      actionWid: env.WORKDAY_SUBMITTED_ACTION_WID,
    });

    await appendLedgerEntry(prisma, {
      employeeId: request.employeeId,
      leaveTypeId: request.leaveTypeId,
      dimensions,
      entryType: 'CONFIRMED_USAGE',
      amount: durationDays.negated(),
      source: 'WORKFLOW',
      leaveRequestId: request.id,
      approvalId: approval.id,
      hcmReferenceId: result.hcmReferenceId,
      idempotencyKey: `confirmed-usage:${request.id}`,
      effectiveAt: request.startDate,
    });

    const updated = await prisma.leaveRequest.update({
      where: { id: request.id },
      data: {
        status: 'APPROVED',
        hcmReferenceId: result.hcmReferenceId,
        hcmPostedAt: new Date(),
      },
    });

    await writeAudit(prisma, {
      action: 'APPROVAL_DECISION',
      actorId: actor?.id,
      actorRole: actor?.role,
      resourceType: 'leave-requests',
      resourceId: request.id,
      correlationId: actor?.correlationId,
      after: { status: 'APPROVED', hcmReferenceId: result.hcmReferenceId },
    });

    await notifyEmployee(prisma, request.employeeId, 'REQUEST_APPROVED', {
      leaveRequestId: request.id,
      hcmReferenceId: result.hcmReferenceId,
    });

    return updated;
  } catch (err) {
    if (err instanceof HcmValidationError) {
      throw new AppError(mapWorkdayErrorCode(err.code), err.message);
    }
    if (err instanceof HcmUnavailableError) {
      const retryDeadline = new Date();
      retryDeadline.setHours(retryDeadline.getHours() + env.HCM_APPROVAL_RETRY_WINDOW_HOURS);

      const updated = await prisma.leaveRequest.update({
        where: { id: request.id },
        data: {
          status: 'APPROVED_PENDING_HCM_UPDATE',
          hcmRetryStartedAt: new Date(),
          hcmRetryDeadlineAt: retryDeadline,
          hcmRetryCount: 0,
        },
      });

      await writeAudit(prisma, {
        action: 'APPROVAL_DECISION',
        actorId: actor?.id,
        actorRole: actor?.role,
        resourceType: 'leave-requests',
        resourceId: request.id,
        correlationId: actor?.correlationId,
        after: { status: 'APPROVED_PENDING_HCM_UPDATE' },
      });

      await notifyEmployee(prisma, request.employeeId, 'APPROVAL_PENDING_HCM_UPDATE', {
        leaveRequestId: request.id,
      });

      return updated;
    }
    throw err;
  }
}

export async function rejectLeaveRequest(
  prisma: PrismaClient,
  leaveRequestId: string,
  approverEmployeeId: string,
  comment?: string,
  actor?: { id?: string; role?: string; correlationId?: string },
) {
  const approval = await prisma.approval.findFirst({
    where: { leaveRequestId, approverEmployeeId, decision: 'PENDING' },
    include: { leaveRequest: true },
  });
  if (!approval) {
    const inChain = await prisma.approval.findFirst({
      where: { leaveRequestId, approverEmployeeId },
    });
    if (!inChain) throw new AppError('FORBIDDEN');
    throw new AppError('APPROVAL_NOT_PENDING');
  }

  await prisma.approval.update({
    where: { id: approval.id },
    data: { decision: 'REJECTED', comment, decidedAt: new Date() },
  });

  const request = approval.leaveRequest;
  const updated = await prisma.leaveRequest.update({
    where: { id: request.id },
    data: { status: 'REJECTED' },
  });

  await appendLedgerEntry(prisma, {
    employeeId: request.employeeId,
    leaveTypeId: request.leaveTypeId,
    dimensions: request.dimensions as Record<string, unknown>,
    entryType: 'RESERVATION_RELEASE',
    amount: new Decimal(request.durationDays.toString()),
    source: 'WORKFLOW',
    leaveRequestId: request.id,
    approvalId: approval.id,
    idempotencyKey: `reservation-release:${request.id}:reject`,
    effectiveAt: new Date(),
  });

  await writeAudit(prisma, {
    action: 'APPROVAL_DECISION',
    actorId: actor?.id,
    actorRole: actor?.role,
    resourceType: 'leave-requests',
    resourceId: request.id,
    correlationId: actor?.correlationId,
    after: { status: 'REJECTED' },
  });

  await notifyEmployee(prisma, request.employeeId, 'REQUEST_REJECTED', {
    leaveRequestId: request.id,
  });

  return updated;
}

function buildTimeOffDays(request: {
  startDate: Date;
  endDate: Date;
  durationDays: { toString(): string };
  leaveType: { externalLeaveTypeId: string };
}): Array<{ date: string; timeOffTypeId: string; quantity: number }> {
  const days: Array<{ date: string; timeOffTypeId: string; quantity: number }> = [];
  const cursor = new Date(request.startDate);
  const perDay = new Decimal(request.durationDays.toString()).div(
    Math.max(1, Math.ceil((request.endDate.getTime() - request.startDate.getTime()) / 86400000) + 1),
  );
  while (cursor <= request.endDate) {
    days.push({
      date: cursor.toISOString().slice(0, 10),
      timeOffTypeId: request.leaveType.externalLeaveTypeId,
      quantity: perDay.toNumber(),
    });
    cursor.setDate(cursor.getDate() + 1);
  }
  return days;
}

export async function retryPendingHcmUpdates(
  prisma: PrismaClient,
  hcm: HcmClient,
  env: Env,
): Promise<{ processed: number; succeeded: number; failed: number }> {
  const now = new Date();
  const pending = await prisma.leaveRequest.findMany({
    where: {
      status: 'APPROVED_PENDING_HCM_UPDATE',
      hcmRetryDeadlineAt: { gt: now },
    },
    include: { employee: true, leaveType: true, approvals: true },
  });

  let succeeded = 0;
  let failed = 0;

  for (const request of pending) {
    const days = buildTimeOffDays(request);
    try {
      const result = await hcm.requestTimeOff(request.employee.externalEmployeeId, {
        days,
        actionWid: env.WORKDAY_SUBMITTED_ACTION_WID,
      });

      await appendLedgerEntry(prisma, {
        employeeId: request.employeeId,
        leaveTypeId: request.leaveTypeId,
        dimensions: request.dimensions as Record<string, unknown>,
        entryType: 'CONFIRMED_USAGE',
        amount: new Decimal(request.durationDays.toString()).negated(),
        source: 'WORKFLOW',
        leaveRequestId: request.id,
        hcmReferenceId: result.hcmReferenceId,
        idempotencyKey: `confirmed-usage:${request.id}`,
        effectiveAt: request.startDate,
      });

      await prisma.leaveRequest.update({
        where: { id: request.id },
        data: {
          status: 'APPROVED',
          hcmReferenceId: result.hcmReferenceId,
          hcmPostedAt: new Date(),
        },
      });
      await notifyEmployee(prisma, request.employeeId, 'REQUEST_APPROVED', {
        leaveRequestId: request.id,
        hcmReferenceId: result.hcmReferenceId,
      });
      succeeded++;
    } catch (err) {
      if (err instanceof HcmValidationError) {
        await prisma.leaveRequest.update({
          where: { id: request.id },
          data: { status: 'REJECTED' },
        });
        await appendLedgerEntry(prisma, {
          employeeId: request.employeeId,
          leaveTypeId: request.leaveTypeId,
          dimensions: request.dimensions as Record<string, unknown>,
          entryType: 'RESERVATION_RELEASE',
          amount: new Decimal(request.durationDays.toString()),
          source: 'WORKFLOW',
          leaveRequestId: request.id,
          idempotencyKey: `reservation-release:${request.id}:hcm-fail`,
          effectiveAt: new Date(),
        });
        await notifyEmployee(prisma, request.employeeId, 'REQUEST_REJECTED', {
          leaveRequestId: request.id,
          reason: 'hcm_validation_failure',
        });
        failed++;
        continue;
      }

      await prisma.leaveRequest.update({
        where: { id: request.id },
        data: {
          hcmRetryCount: { increment: 1 },
          lastHcmRetryAt: new Date(),
        },
      });
      failed++;
    }
  }

  const expired = await prisma.leaveRequest.findMany({
    where: {
      status: 'APPROVED_PENDING_HCM_UPDATE',
      hcmRetryDeadlineAt: { lte: now },
    },
  });

  for (const request of expired) {
    await prisma.leaveRequest.update({
      where: { id: request.id },
      data: { status: 'REJECTED' },
    });
    await appendLedgerEntry(prisma, {
      employeeId: request.employeeId,
      leaveTypeId: request.leaveTypeId,
      dimensions: request.dimensions as Record<string, unknown>,
      entryType: 'RESERVATION_RELEASE',
      amount: new Decimal(request.durationDays.toString()),
      source: 'WORKFLOW',
      leaveRequestId: request.id,
      idempotencyKey: `reservation-release:${request.id}:expired`,
      effectiveAt: new Date(),
    });
    await notifyEmployee(prisma, request.employeeId, 'HCM_APPROVAL_SYNC_FAILED', {
      leaveRequestId: request.id,
    });
    failed++;
  }

  return { processed: pending.length + expired.length, succeeded, failed };
}
