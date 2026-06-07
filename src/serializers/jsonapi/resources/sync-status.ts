import { singleDocument } from '../document.js';

export interface SyncStatusView {
  syncSource: string;
  lastSyncStartedAt?: string;
  lastSyncCompletedAt?: string;
  lastSyncStatus: string;
  employeeCount?: number;
  balanceCount?: number;
  stalenessSeconds?: number;
}

export function serializeSyncStatus(status: SyncStatusView) {
  return singleDocument('sync-status', 'current', {
    syncSource: status.syncSource,
    lastSyncStartedAt: status.lastSyncStartedAt,
    lastSyncCompletedAt: status.lastSyncCompletedAt,
    lastSyncStatus: status.lastSyncStatus,
    employeeCount: status.employeeCount,
    balanceCount: status.balanceCount,
    stalenessSeconds: status.stalenessSeconds,
  });
}
