-- CreateTable
CREATE TABLE "employee_hcm_mappings" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "externalEmployeeId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "managerExternalEmployeeId" TEXT,
    "managerId" TEXT,
    "department" TEXT,
    "employmentStatus" TEXT NOT NULL,
    "syncCorrelationKey" TEXT,
    "lastSyncedAt" DATETIME NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "employee_hcm_mappings_managerId_fkey" FOREIGN KEY ("managerId") REFERENCES "employee_hcm_mappings" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "time_off_sync_state" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "syncSource" TEXT NOT NULL,
    "lastSyncStartedAt" DATETIME,
    "lastSyncCompletedAt" DATETIME,
    "lastSyncStatus" TEXT NOT NULL DEFAULT 'IN_PROGRESS',
    "lastSyncCursor" TEXT,
    "errorDetails" JSONB,
    "syncInProgress" BOOLEAN NOT NULL DEFAULT false,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "leave_types" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "externalLeaveTypeId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "isPaid" BOOLEAN NOT NULL DEFAULT true,
    "requiresApproval" BOOLEAN NOT NULL DEFAULT true,
    "requiresDocumentation" BOOLEAN NOT NULL DEFAULT false,
    "allowPartialDay" BOOLEAN NOT NULL DEFAULT true,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "lastSyncedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "leave_policies" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "externalPolicyId" TEXT NOT NULL,
    "leaveTypeId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "effectiveFrom" DATETIME NOT NULL,
    "effectiveTo" DATETIME,
    "location" TEXT,
    "department" TEXT,
    "employmentType" TEXT,
    "minTenureDays" INTEGER,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "lastSyncedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "leave_policies_leaveTypeId_fkey" FOREIGN KEY ("leaveTypeId") REFERENCES "leave_types" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "leave_policy_rules" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "policyId" TEXT NOT NULL,
    "ruleType" TEXT NOT NULL,
    "config" JSONB NOT NULL,
    "priority" INTEGER NOT NULL DEFAULT 0,
    CONSTRAINT "leave_policy_rules_policyId_fkey" FOREIGN KEY ("policyId") REFERENCES "leave_policies" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "leave_balances" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "employeeId" TEXT NOT NULL,
    "leaveTypeId" TEXT NOT NULL,
    "dimensions" JSONB NOT NULL,
    "dimensionsHash" TEXT NOT NULL,
    "currentBalance" DECIMAL NOT NULL,
    "unit" TEXT NOT NULL DEFAULT 'days',
    "lastSyncedAt" DATETIME,
    "hcmUpdatedAt" DATETIME,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "leave_balances_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "employee_hcm_mappings" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "leave_balances_leaveTypeId_fkey" FOREIGN KEY ("leaveTypeId") REFERENCES "leave_types" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "leave_balance_ledger" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "employeeId" TEXT NOT NULL,
    "leaveTypeId" TEXT NOT NULL,
    "dimensions" JSONB NOT NULL,
    "dimensionsHash" TEXT NOT NULL,
    "entryType" TEXT NOT NULL,
    "amount" DECIMAL NOT NULL,
    "source" TEXT NOT NULL,
    "leaveRequestId" TEXT,
    "approvalId" TEXT,
    "hcmReferenceId" TEXT,
    "syncRunId" TEXT,
    "idempotencyKey" TEXT,
    "effectiveAt" DATETIME NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "leave_balance_ledger_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "employee_hcm_mappings" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "leave_balance_ledger_leaveTypeId_fkey" FOREIGN KEY ("leaveTypeId") REFERENCES "leave_types" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "leave_balance_ledger_leaveRequestId_fkey" FOREIGN KEY ("leaveRequestId") REFERENCES "leave_requests" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "leave_balance_ledger_approvalId_fkey" FOREIGN KEY ("approvalId") REFERENCES "approvals" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "leave_balance_ledger_syncRunId_fkey" FOREIGN KEY ("syncRunId") REFERENCES "sync_runs" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "leave_requests" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "employeeId" TEXT NOT NULL,
    "leaveTypeId" TEXT NOT NULL,
    "startDate" DATETIME NOT NULL,
    "endDate" DATETIME NOT NULL,
    "durationDays" DECIMAL NOT NULL,
    "partialDayType" TEXT NOT NULL DEFAULT 'NONE',
    "partialDayHours" DECIMAL,
    "dimensions" JSONB NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "reason" TEXT,
    "submittedAt" DATETIME,
    "cancelledAt" DATETIME,
    "hcmReferenceId" TEXT,
    "hcmPostedAt" DATETIME,
    "hcmRetryStartedAt" DATETIME,
    "hcmRetryDeadlineAt" DATETIME,
    "hcmRetryCount" INTEGER NOT NULL DEFAULT 0,
    "lastHcmRetryAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "leave_requests_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "employee_hcm_mappings" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "leave_requests_leaveTypeId_fkey" FOREIGN KEY ("leaveTypeId") REFERENCES "leave_types" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "approvals" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "leaveRequestId" TEXT NOT NULL,
    "approverEmployeeId" TEXT NOT NULL,
    "approvalLevel" INTEGER NOT NULL,
    "decision" TEXT NOT NULL DEFAULT 'PENDING',
    "comment" TEXT,
    "decidedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "approvals_leaveRequestId_fkey" FOREIGN KEY ("leaveRequestId") REFERENCES "leave_requests" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "approvals_approverEmployeeId_fkey" FOREIGN KEY ("approverEmployeeId") REFERENCES "employee_hcm_mappings" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "holidays" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "date" DATETIME NOT NULL,
    "location" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true
);

-- CreateTable
CREATE TABLE "notifications" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "type" TEXT NOT NULL,
    "recipientEmployeeId" TEXT,
    "payload" JSONB NOT NULL,
    "deliveredAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "notifications_recipientEmployeeId_fkey" FOREIGN KEY ("recipientEmployeeId") REFERENCES "employee_hcm_mappings" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "action" TEXT NOT NULL,
    "actorId" TEXT,
    "actorRole" TEXT,
    "resourceType" TEXT NOT NULL,
    "resourceId" TEXT NOT NULL,
    "before" JSONB,
    "after" JSONB,
    "correlationId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "sync_runs" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "syncType" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "correlationId" TEXT NOT NULL,
    "startedAt" DATETIME NOT NULL,
    "completedAt" DATETIME,
    "employeeCount" INTEGER,
    "balanceCount" INTEGER,
    "adjustmentCount" INTEGER,
    "errorDetails" JSONB,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "integration_events" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "source" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "processedAt" DATETIME,
    "error" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "idempotency_keys" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "key" TEXT NOT NULL,
    "route" TEXT NOT NULL,
    "responseBody" JSONB NOT NULL,
    "statusCode" INTEGER NOT NULL,
    "expiresAt" DATETIME NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateIndex
CREATE UNIQUE INDEX "employee_hcm_mappings_externalEmployeeId_key" ON "employee_hcm_mappings"("externalEmployeeId");

-- CreateIndex
CREATE UNIQUE INDEX "leave_types_externalLeaveTypeId_key" ON "leave_types"("externalLeaveTypeId");

-- CreateIndex
CREATE UNIQUE INDEX "leave_types_code_key" ON "leave_types"("code");

-- CreateIndex
CREATE UNIQUE INDEX "leave_policies_externalPolicyId_key" ON "leave_policies"("externalPolicyId");

-- CreateIndex
CREATE UNIQUE INDEX "leave_balances_employeeId_leaveTypeId_dimensionsHash_key" ON "leave_balances"("employeeId", "leaveTypeId", "dimensionsHash");

-- CreateIndex
CREATE UNIQUE INDEX "leave_balance_ledger_idempotencyKey_key" ON "leave_balance_ledger"("idempotencyKey");

-- CreateIndex
CREATE UNIQUE INDEX "idempotency_keys_key_key" ON "idempotency_keys"("key");
