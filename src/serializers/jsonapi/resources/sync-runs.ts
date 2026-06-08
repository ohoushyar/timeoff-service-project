import type { SyncRun } from '@prisma/client';
import { omitNulls, singleDocument, collectionDocument } from '../document.js';

function syncRunAttributes(run: SyncRun): Record<string, unknown> {
  return omitNulls({
    syncType: run.syncType,
    status: run.status,
    correlationId: run.correlationId,
    startedAt: run.startedAt.toISOString(),
    completedAt: run.completedAt?.toISOString(),
    employeeCount: run.employeeCount,
    balanceCount: run.balanceCount,
    adjustmentCount: run.adjustmentCount,
    errorDetails: run.errorDetails,
    createdAt: run.createdAt.toISOString(),
  });
}

export function serializeSyncRun(run: SyncRun) {
  return singleDocument('sync-runs', run.id, syncRunAttributes(run));
}

export function serializeSyncRuns(
  items: SyncRun[],
  opts: { basePath: string; pageNumber: number; pageSize: number; totalCount: number },
) {
  return collectionDocument(
    'sync-runs',
    items.map((run) => ({ id: run.id, attributes: syncRunAttributes(run) })),
    opts,
  );
}
