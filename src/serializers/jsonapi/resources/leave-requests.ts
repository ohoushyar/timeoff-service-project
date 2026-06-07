import type { LeaveRequest } from '@prisma/client';
import { omitNulls, singleDocument, collectionDocument } from '../document.js';

export function serializeLeaveRequest(req: LeaveRequest) {
  return singleDocument('leave-requests', req.id, omitNulls({
    startDate: req.startDate.toISOString().slice(0, 10),
    endDate: req.endDate.toISOString().slice(0, 10),
    durationDays: Number(req.durationDays),
    partialDayType: req.partialDayType,
    partialDayHours: req.partialDayHours ? Number(req.partialDayHours) : undefined,
    dimensions: req.dimensions,
    status: req.status,
    reason: req.reason,
    submittedAt: req.submittedAt?.toISOString(),
    cancelledAt: req.cancelledAt?.toISOString(),
    hcmReferenceId: req.hcmReferenceId,
    hcmPostedAt: req.hcmPostedAt?.toISOString(),
    createdAt: req.createdAt.toISOString(),
    updatedAt: req.updatedAt.toISOString(),
  }), {
    employee: { data: { type: 'employees', id: req.employeeId } },
    leaveType: { data: { type: 'leave-types', id: req.leaveTypeId } },
  });
}

export function serializeLeaveRequests(
  items: LeaveRequest[],
  opts: { basePath: string; pageNumber: number; pageSize: number; totalCount: number },
) {
  return collectionDocument(
    'leave-requests',
    items.map((req) => ({
      id: req.id,
      attributes: omitNulls({
        startDate: req.startDate.toISOString().slice(0, 10),
        endDate: req.endDate.toISOString().slice(0, 10),
        durationDays: Number(req.durationDays),
        status: req.status,
        reason: req.reason,
        submittedAt: req.submittedAt?.toISOString(),
      }) as Record<string, unknown>,
      relationships: {
        employee: { data: { type: 'employees', id: req.employeeId } },
        leaveType: { data: { type: 'leave-types', id: req.leaveTypeId } },
      },
    })),
    opts,
  );
}
