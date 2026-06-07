import type { Approval } from '@prisma/client';
import { omitNulls, collectionDocument } from '../document.js';

export function serializeApprovals(
  items: Approval[],
  opts: { basePath: string; pageNumber: number; pageSize: number; totalCount: number },
) {
  return collectionDocument(
    'approvals',
    items.map((a) => ({
      id: a.id,
      attributes: omitNulls({
        approvalLevel: a.approvalLevel,
        decision: a.decision,
        comment: a.comment,
        decidedAt: a.decidedAt?.toISOString(),
        createdAt: a.createdAt.toISOString(),
      }) as Record<string, unknown>,
      relationships: {
        leaveRequest: { data: { type: 'leave-requests', id: a.leaveRequestId } },
        approver: { data: { type: 'employees', id: a.approverEmployeeId } },
      },
    })),
    opts,
  );
}
