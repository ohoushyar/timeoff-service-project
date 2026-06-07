import type { LeaveBalanceLedger } from '@prisma/client';
import { omitNulls, collectionDocument } from '../document.js';

export function serializeLedgerEntries(
  items: LeaveBalanceLedger[],
  opts: { basePath: string; pageNumber: number; pageSize: number; totalCount: number },
) {
  return collectionDocument(
    'leave-balance-ledger-entries',
    items.map((e) => ({
      id: e.id,
      attributes: omitNulls({
        dimensions: e.dimensions,
        entryType: e.entryType,
        amount: Number(e.amount),
        source: e.source,
        leaveRequestId: e.leaveRequestId,
        syncRunId: e.syncRunId,
        effectiveAt: e.effectiveAt.toISOString(),
        createdAt: e.createdAt.toISOString(),
      }) as Record<string, unknown>,
      relationships: {
        employee: { data: { type: 'employees', id: e.employeeId } },
        leaveType: { data: { type: 'leave-types', id: e.leaveTypeId } },
      },
    })),
    opts,
  );
}
