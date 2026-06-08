import { collectionDocument } from '../document.js';

export function serializeLeaveUsageReport(
  rows: Array<{
    id: string;
    employeeId: string;
    leaveTypeId: string;
    leaveTypeName: string;
    startDate: Date;
    endDate: Date;
    durationDays: number;
    status: string;
    department?: string | null;
  }>,
  summary: Record<string, unknown>,
) {
  return {
    jsonapi: { version: '1.1' as const },
    data: rows.map((row) => ({
      type: 'leave-usage-report-rows' as const,
      id: row.id,
      attributes: {
        employeeId: row.employeeId,
        leaveTypeId: row.leaveTypeId,
        leaveTypeName: row.leaveTypeName,
        startDate: row.startDate.toISOString().slice(0, 10),
        endDate: row.endDate.toISOString().slice(0, 10),
        durationDays: row.durationDays,
        status: row.status,
        department: row.department,
      },
    })),
    meta: { summary },
  };
}

export function serializeTeamCalendarReport(
  rows: Array<{
    id: string;
    employeeId: string;
    leaveTypeId: string;
    leaveTypeName: string;
    startDate: Date;
    endDate: Date;
    status: string;
    department?: string | null;
  }>,
  summary: Record<string, unknown>,
) {
  return {
    jsonapi: { version: '1.1' as const },
    data: rows.map((row) => ({
      type: 'team-calendar-report-rows' as const,
      id: row.id,
      attributes: {
        employeeId: row.employeeId,
        leaveTypeId: row.leaveTypeId,
        leaveTypeName: row.leaveTypeName,
        startDate: row.startDate.toISOString().slice(0, 10),
        endDate: row.endDate.toISOString().slice(0, 10),
        status: row.status,
        department: row.department,
      },
      relationships: {
        employee: { data: { type: 'employees', id: row.employeeId } },
        leaveType: { data: { type: 'leave-types', id: row.leaveTypeId } },
      },
    })),
    meta: { summary },
  };
}

export function serializeAuditReport(
  rows: Array<{
    id: string;
    action: string;
    actorId?: string | null;
    actorRole?: string | null;
    resourceType: string;
    resourceId: string;
    before: unknown;
    after: unknown;
    correlationId?: string | null;
    createdAt: Date;
  }>,
  opts: { basePath: string; pageNumber: number; pageSize: number; totalCount: number },
) {
  return collectionDocument(
    'audit-logs',
    rows.map((row) => ({
      id: row.id,
      attributes: {
        action: row.action,
        actorId: row.actorId,
        actorRole: row.actorRole,
        resourceType: row.resourceType,
        resourceId: row.resourceId,
        before: row.before,
        after: row.after,
        correlationId: row.correlationId,
        createdAt: row.createdAt.toISOString(),
      },
    })),
    opts,
  );
}
