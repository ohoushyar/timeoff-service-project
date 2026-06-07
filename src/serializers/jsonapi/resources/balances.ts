import { omitNulls, collectionDocument } from '../document.js';

export interface BalanceView {
  id: string;
  employeeId: string;
  leaveTypeId: string;
  dimensions: unknown;
  currentBalance: number;
  ledgerBalance: number;
  pendingBalance: number;
  availableBalance: number;
  unit: string;
  lastSyncedAt?: string;
}

export function serializeBalances(
  items: BalanceView[],
  opts: { basePath: string; pageNumber: number; pageSize: number; totalCount: number },
) {
  return collectionDocument(
    'leave-balances',
    items.map((b) => ({
      id: b.id,
      attributes: omitNulls({
        dimensions: b.dimensions,
        currentBalance: b.currentBalance,
        ledgerBalance: b.ledgerBalance,
        pendingBalance: b.pendingBalance,
        availableBalance: b.availableBalance,
        unit: b.unit,
        lastSyncedAt: b.lastSyncedAt,
      }) as Record<string, unknown>,
      relationships: {
        employee: { data: { type: 'employees', id: b.employeeId } },
        leaveType: { data: { type: 'leave-types', id: b.leaveTypeId } },
      },
    })),
    opts,
  );
}
