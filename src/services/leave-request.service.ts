import { Decimal } from 'decimal.js';
import type { PrismaClient, PartialDayType, LeaveRequestStatus } from '@prisma/client';
import { AppError } from '../errors/app-error.js';
import type { HcmClient } from '../integrations/hcm/types.js';
import { HcmUnavailableError } from '../integrations/hcm/types.js';
import { dimensionsHash } from '../lib/dimensions.js';
import { appendLedgerEntry } from './ledger.service.js';
import { checkAvailableBalance } from './balance.service.js';
import { writeAudit } from './audit.service.js';
import { toJsonValue } from '../lib/json.js';
import {
  resolvePolicy,
  checkEligibility,
  allowsNegativeBalance,
  buildApprovalChain,
  computeDurationDays,
  datesOverlap,
  requiresDocumentation,
  type PolicyWithRules,
} from './policy-engine.js';
import type { Env } from '../config/env.js';

export interface CreateLeaveRequestInput {
  employeeId: string;
  leaveTypeId: string;
  startDate: Date;
  endDate: Date;
  partialDayType?: PartialDayType;
  partialDayHours?: number;
  dimensions: Record<string, unknown>;
  reason?: string;
  submit?: boolean;
  documentationProvided?: boolean;
}

export async function createLeaveRequest(
  prisma: PrismaClient,
  hcm: HcmClient,
  env: Env,
  input: CreateLeaveRequestInput,
  actor: { id?: string; role?: string; correlationId?: string },
) {
  const employee = await prisma.employeeHcmMapping.findUnique({
    where: { id: input.employeeId },
    include: { manager: true },
  });
  if (!employee) throw new AppError('EMPLOYEE_NOT_FOUND');
  if (employee.employmentStatus !== 'ACTIVE') throw new AppError('EMPLOYEE_INACTIVE');

  const leaveType = await prisma.leaveType.findUnique({ where: { id: input.leaveTypeId } });
  if (!leaveType || !leaveType.isActive) throw new AppError('LEAVE_TYPE_NOT_FOUND');

  const location = input.dimensions.locationId as string | undefined;
  const policies = await prisma.leavePolicy.findMany({
    where: { leaveTypeId: leaveType.id, isActive: true },
    include: { rules: true },
  });
  const policy = resolvePolicy(policies as PolicyWithRules[], employee, leaveType.id, location);
  if (!checkEligibility(employee, policy)) throw new AppError('NOT_ELIGIBLE');

  const holidays = await prisma.holiday.findMany({ where: { isActive: true } });
  const durationDays = computeDurationDays(
    input.startDate,
    input.endDate,
    input.partialDayType ?? 'NONE',
    input.partialDayHours ?? null,
    holidays,
    location,
  );

  if (requiresDocumentation(policy, durationDays) && !input.documentationProvided) {
    throw new AppError('DOCUMENTATION_REQUIRED');
  }

  const hash = dimensionsHash(input.dimensions);
  const balanceRow = await prisma.leaveBalance.findUnique({
    where: {
      employeeId_leaveTypeId_dimensionsHash: {
        employeeId: input.employeeId,
        leaveTypeId: leaveType.id,
        dimensionsHash: hash,
      },
    },
  });
  if (!balanceRow) throw new AppError('INVALID_TIME_OFF_DIMENSIONS');

  const overlapping = await prisma.leaveRequest.findFirst({
    where: {
      employeeId: input.employeeId,
      status: { in: ['PENDING', 'APPROVED', 'APPROVED_PENDING_HCM_UPDATE'] },
      startDate: { lte: input.endDate },
      endDate: { gte: input.startDate },
    },
  });
  if (overlapping) throw new AppError('OVERLAPPING_REQUEST');

  const negativeAllowed = allowsNegativeBalance(policy);
  const { sufficient } = await checkAvailableBalance(
    prisma,
    input.employeeId,
    leaveType.id,
    input.dimensions,
    durationDays,
    negativeAllowed,
  );

  if (input.submit) {
    try {
      await hcm.fetchBalances(employee.externalEmployeeId, input.startDate.toISOString().slice(0, 10));
    } catch (err) {
      if (!(err instanceof HcmUnavailableError)) throw err;
    }
  }

  if (input.submit && !sufficient) {
    throw new AppError('INSUFFICIENT_BALANCE');
  }

  const status: LeaveRequestStatus = input.submit ? 'PENDING' : 'DRAFT';

  if (input.submit) {
    buildApprovalChain(employee, employee.manager);
  }

  const request = await prisma.leaveRequest.create({
    data: {
      employeeId: input.employeeId,
      leaveTypeId: leaveType.id,
      startDate: input.startDate,
      endDate: input.endDate,
      durationDays,
      partialDayType: input.partialDayType ?? 'NONE',
      partialDayHours: input.partialDayHours,
      dimensions: toJsonValue(input.dimensions),
      status,
      reason: input.reason,
      submittedAt: input.submit ? new Date() : null,
    },
  });

  if (input.submit) {
    await appendLedgerEntry(prisma, {
      employeeId: input.employeeId,
      leaveTypeId: leaveType.id,
      dimensions: input.dimensions,
      entryType: 'PENDING_RESERVATION',
      amount: durationDays.negated(),
      source: 'WORKFLOW',
      leaveRequestId: request.id,
      idempotencyKey: `pending-reservation:${request.id}`,
      effectiveAt: input.startDate,
    });

    const chain = buildApprovalChain(employee, employee.manager);
    for (const step of chain) {
      await prisma.approval.create({
        data: {
          leaveRequestId: request.id,
          approverEmployeeId: step.approverEmployeeId,
          approvalLevel: step.approvalLevel,
        },
      });
    }
  }

  await writeAudit(prisma, {
    action: 'LEAVE_REQUEST_CREATED',
    actorId: actor.id,
    actorRole: actor.role,
    resourceType: 'leave-requests',
    resourceId: request.id,
    correlationId: actor.correlationId,
    after: { status: request.status, durationDays: durationDays.toNumber() },
  });

  return request;
}

export async function cancelLeaveRequest(
  prisma: PrismaClient,
  requestId: string,
  actor: { id?: string; role?: string; correlationId?: string },
) {
  const request = await prisma.leaveRequest.findUnique({ where: { id: requestId } });
  if (!request) throw new AppError('NOT_FOUND');

  if (!['PENDING', 'APPROVED_PENDING_HCM_UPDATE', 'DRAFT'].includes(request.status)) {
    throw new AppError('INVALID_WORKFLOW_TRANSITION');
  }

  const updated = await prisma.leaveRequest.update({
    where: { id: requestId },
    data: { status: 'CANCELLED', cancelledAt: new Date() },
  });

  if (['PENDING', 'APPROVED_PENDING_HCM_UPDATE'].includes(request.status)) {
    await appendLedgerEntry(prisma, {
      employeeId: request.employeeId,
      leaveTypeId: request.leaveTypeId,
      dimensions: request.dimensions as Record<string, unknown>,
      entryType: 'RESERVATION_RELEASE',
      amount: new Decimal(request.durationDays.toString()),
      source: 'WORKFLOW',
      leaveRequestId: request.id,
      idempotencyKey: `reservation-release:${request.id}:cancel`,
      effectiveAt: new Date(),
    });
  }

  await writeAudit(prisma, {
    action: 'LEAVE_REQUEST_CANCELLED',
    actorId: actor.id,
    actorRole: actor.role,
    resourceType: 'leave-requests',
    resourceId: requestId,
    correlationId: actor.correlationId,
    before: { status: request.status },
    after: { status: 'CANCELLED' },
  });

  return updated;
}

export async function listLeaveRequests(
  prisma: PrismaClient,
  filters: {
    employeeId?: string;
    employeeIds?: string[];
    status?: string;
    page: number;
    pageSize: number;
  },
) {
  const where: Record<string, unknown> = {};
  if (filters.employeeId) where.employeeId = filters.employeeId;
  if (filters.employeeIds?.length) where.employeeId = { in: filters.employeeIds };
  if (filters.status) where.status = filters.status.toUpperCase();

  const [items, totalCount] = await Promise.all([
    prisma.leaveRequest.findMany({
      where,
      skip: (filters.page - 1) * filters.pageSize,
      take: filters.pageSize,
      orderBy: { createdAt: 'desc' },
    }),
    prisma.leaveRequest.count({ where }),
  ]);
  return { items, totalCount };
}

export async function getLeaveRequest(prisma: PrismaClient, id: string) {
  const request = await prisma.leaveRequest.findUnique({ where: { id } });
  if (!request) throw new AppError('NOT_FOUND');
  return request;
}

export interface UpdateLeaveRequestInput {
  startDate?: Date;
  endDate?: Date;
  partialDayType?: PartialDayType;
  partialDayHours?: number;
  dimensions?: Record<string, unknown>;
  reason?: string;
}

export async function updateLeaveRequest(
  prisma: PrismaClient,
  id: string,
  input: UpdateLeaveRequestInput,
  actor: { id?: string; role?: string; correlationId?: string },
) {
  const existing = await getLeaveRequest(prisma, id);
  if (existing.status !== 'DRAFT') {
    throw new AppError('INVALID_WORKFLOW_TRANSITION');
  }

  const startDate = input.startDate ?? existing.startDate;
  const endDate = input.endDate ?? existing.endDate;
  const partialDayType = input.partialDayType ?? existing.partialDayType;
  const partialDayHours = input.partialDayHours ?? existing.partialDayHours;
  const dimensions = input.dimensions ?? (existing.dimensions as Record<string, unknown>);
  const reason = input.reason !== undefined ? input.reason : existing.reason;

  const leaveType = await prisma.leaveType.findUnique({ where: { id: existing.leaveTypeId } });
  if (!leaveType) throw new AppError('LEAVE_TYPE_NOT_FOUND');

  const hash = dimensionsHash(dimensions);
  const balanceRow = await prisma.leaveBalance.findUnique({
    where: {
      employeeId_leaveTypeId_dimensionsHash: {
        employeeId: existing.employeeId,
        leaveTypeId: existing.leaveTypeId,
        dimensionsHash: hash,
      },
    },
  });
  if (!balanceRow) throw new AppError('INVALID_TIME_OFF_DIMENSIONS');

  const holidays = await prisma.holiday.findMany({ where: { isActive: true } });
  const location = dimensions.locationId as string | undefined;
  const durationDays = computeDurationDays(
    startDate,
    endDate,
    partialDayType,
    partialDayHours,
    holidays,
    location,
  );

  const overlapping = await prisma.leaveRequest.findFirst({
    where: {
      id: { not: id },
      employeeId: existing.employeeId,
      status: { in: ['PENDING', 'APPROVED', 'APPROVED_PENDING_HCM_UPDATE'] },
      startDate: { lte: endDate },
      endDate: { gte: startDate },
    },
  });
  if (overlapping) throw new AppError('OVERLAPPING_REQUEST');

  const updated = await prisma.leaveRequest.update({
    where: { id },
    data: {
      startDate,
      endDate,
      partialDayType,
      partialDayHours,
      dimensions: toJsonValue(dimensions),
      reason,
      durationDays,
    },
  });

  await writeAudit(prisma, {
    action: 'LEAVE_REQUEST_UPDATED',
    actorId: actor.id,
    actorRole: actor.role,
    resourceType: 'leave-requests',
    resourceId: id,
    correlationId: actor.correlationId,
    after: { status: updated.status, durationDays: durationDays.toNumber() },
  });

  return updated;
}

export { datesOverlap };
