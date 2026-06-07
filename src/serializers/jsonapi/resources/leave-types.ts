import type { LeaveType } from '@prisma/client';
import { omitNulls, singleDocument, collectionDocument } from '../document.js';

export function serializeLeaveType(lt: LeaveType) {
  return singleDocument('leave-types', lt.id, omitNulls({
    code: lt.code,
    name: lt.name,
    description: lt.description,
    isPaid: lt.isPaid,
    requiresApproval: lt.requiresApproval,
    requiresDocumentation: lt.requiresDocumentation,
    allowPartialDay: lt.allowPartialDay,
    isActive: lt.isActive,
    lastSyncedAt: lt.lastSyncedAt?.toISOString(),
  }));
}

export function serializeLeaveTypes(
  items: LeaveType[],
  opts: { basePath: string; pageNumber: number; pageSize: number; totalCount: number },
) {
  return collectionDocument(
    'leave-types',
    items.map((lt) => ({
      id: lt.id,
      attributes: omitNulls({
        code: lt.code,
        name: lt.name,
        description: lt.description,
        isPaid: lt.isPaid,
        requiresApproval: lt.requiresApproval,
        isActive: lt.isActive,
      }) as Record<string, unknown>,
    })),
    opts,
  );
}
