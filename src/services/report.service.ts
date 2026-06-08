import type { Prisma, PrismaClient } from '@prisma/client';
import { Decimal } from 'decimal.js';
import { AppError } from '../errors/app-error.js';

export interface ReportFilters {
  startDate?: Date;
  endDate?: Date;
  department?: string;
  employeeId?: string;
  teamEmployeeIds?: string[];
}

export function parseReportFilters(query: Record<string, unknown>): ReportFilters {
  const filter = query.filter as Record<string, string> | undefined;
  const filters: ReportFilters = {};
  if (filter?.startDate) filters.startDate = new Date(filter.startDate);
  if (filter?.endDate) filters.endDate = new Date(filter.endDate);
  if (filter?.department) filters.department = filter.department;
  if (filter?.employeeId) filters.employeeId = filter.employeeId;
  return filters;
}

function dateRangeWhere(filters: ReportFilters): Record<string, unknown> {
  const where: Record<string, unknown> = {};
  if (filters.startDate || filters.endDate) {
    where.AND = [
      filters.endDate ? { startDate: { lte: filters.endDate } } : {},
      filters.startDate ? { endDate: { gte: filters.startDate } } : {},
    ].filter((clause) => Object.keys(clause).length > 0);
  }
  return where;
}

function employeeScopeWhere(filters: ReportFilters): Record<string, unknown> {
  if (filters.employeeId) return { employeeId: filters.employeeId };
  if (filters.teamEmployeeIds?.length) {
    return { employeeId: { in: filters.teamEmployeeIds } };
  }
  if (filters.department) {
    return { employee: { department: filters.department } };
  }
  return {};
}

export async function getLeaveUsageReport(
  prisma: PrismaClient,
  filters: ReportFilters,
) {
  const where: Prisma.LeaveRequestWhereInput = {
    status: { in: ['APPROVED', 'APPROVED_PENDING_HCM_UPDATE'] },
    ...dateRangeWhere(filters),
    ...employeeScopeWhere(filters),
  };

  const requests = await prisma.leaveRequest.findMany({
    where,
    include: { leaveType: true, employee: true },
  });

  let totalDays = new Decimal(0);
  const byLeaveType: Record<string, { leaveTypeId: string; leaveTypeName: string; totalDays: number; count: number }> = {};

  for (const req of requests) {
    const days = new Decimal(req.durationDays.toString());
    totalDays = totalDays.plus(days);
    const key = req.leaveTypeId;
    if (!byLeaveType[key]) {
      byLeaveType[key] = {
        leaveTypeId: req.leaveTypeId,
        leaveTypeName: req.leaveType.name,
        totalDays: 0,
        count: 0,
      };
    }
    byLeaveType[key].totalDays += days.toNumber();
    byLeaveType[key].count += 1;
  }

  return {
    rows: requests.map((req) => ({
      id: req.id,
      employeeId: req.employeeId,
      leaveTypeId: req.leaveTypeId,
      leaveTypeName: req.leaveType.name,
      startDate: req.startDate,
      endDate: req.endDate,
      durationDays: Number(req.durationDays),
      status: req.status,
      department: req.employee.department,
    })),
    summary: {
      totalDays: totalDays.toNumber(),
      requestCount: requests.length,
      byLeaveType: Object.values(byLeaveType),
    },
  };
}

export async function getTeamCalendarReport(
  prisma: PrismaClient,
  filters: ReportFilters,
) {
  if (!filters.teamEmployeeIds?.length && !filters.employeeId) {
    throw new AppError('VALIDATION_ERROR', 'Team scope required for team calendar report');
  }

  const where: Prisma.LeaveRequestWhereInput = {
    status: { in: ['PENDING', 'APPROVED', 'APPROVED_PENDING_HCM_UPDATE'] },
    ...dateRangeWhere(filters),
    ...employeeScopeWhere(filters),
  };

  const requests = await prisma.leaveRequest.findMany({
    where,
    include: { leaveType: true, employee: true },
    orderBy: { startDate: 'asc' },
  });

  return {
    rows: requests.map((req) => ({
      id: req.id,
      employeeId: req.employeeId,
      leaveTypeId: req.leaveTypeId,
      leaveTypeName: req.leaveType.name,
      startDate: req.startDate,
      endDate: req.endDate,
      status: req.status,
      department: req.employee.department,
    })),
    summary: {
      requestCount: requests.length,
    },
  };
}

function stripEmailFromJson(value: unknown): unknown {
  if (value === null || value === undefined) return value;
  if (Array.isArray(value)) return value.map(stripEmailFromJson);
  if (typeof value === 'object') {
    const obj = { ...(value as Record<string, unknown>) };
    delete obj.email;
    for (const key of Object.keys(obj)) {
      obj[key] = stripEmailFromJson(obj[key]);
    }
    return obj;
  }
  return value;
}

export async function getAuditReport(
  prisma: PrismaClient,
  filters: ReportFilters,
  page: number,
  pageSize: number,
) {
  const where: Record<string, unknown> = {};
  if (filters.startDate || filters.endDate) {
    where.createdAt = {
      ...(filters.startDate ? { gte: filters.startDate } : {}),
      ...(filters.endDate ? { lte: filters.endDate } : {}),
    };
  }

  const [items, totalCount] = await Promise.all([
    prisma.auditLog.findMany({
      where,
      skip: (page - 1) * pageSize,
      take: pageSize,
      orderBy: { createdAt: 'desc' },
    }),
    prisma.auditLog.count({ where }),
  ]);

  return {
    rows: items.map((log) => ({
      id: log.id,
      action: log.action,
      actorId: log.actorId,
      actorRole: log.actorRole,
      resourceType: log.resourceType,
      resourceId: log.resourceId,
      before: stripEmailFromJson(log.before),
      after: stripEmailFromJson(log.after),
      correlationId: log.correlationId,
      createdAt: log.createdAt,
    })),
    totalCount,
  };
}
