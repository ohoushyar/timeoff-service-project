export interface EmployeeSnapshot {
  externalEmployeeId: string;
  email: string;
  managerExternalEmployeeId?: string;
  department?: string;
  employmentStatus: 'ACTIVE' | 'INACTIVE' | 'TERMINATED' | 'ON_LEAVE';
}

export interface EmployeeSnapshotPage {
  data: EmployeeSnapshot[];
  total: number;
  hasMore: boolean;
}

export interface BatchParams {
  offset?: number;
  limit?: number;
  correlationId?: string;
}

export interface HcmLeaveType {
  externalLeaveTypeId: string;
  code: string;
  name: string;
  description?: string;
  isPaid?: boolean;
  requiresApproval?: boolean;
  requiresDocumentation?: boolean;
  allowPartialDay?: boolean;
}

export interface HcmPolicy {
  externalPolicyId: string;
  externalLeaveTypeId: string;
  name: string;
  effectiveFrom: string;
  effectiveTo?: string;
  location?: string;
  department?: string;
  employmentType?: string;
  minTenureDays?: number;
  rules: HcmPolicyRule[];
}

export interface HcmPolicyRule {
  ruleType: string;
  config: Record<string, unknown>;
  priority?: number;
}

export interface BalanceRow {
  externalLeaveTypeId: string;
  dimensions: Record<string, unknown>;
  currentBalance: number;
  unit: string;
  hcmUpdatedAt?: string;
}

export interface RequestTimeOffDay {
  date: string;
  timeOffTypeId: string;
  quantity: number;
}

export interface RequestTimeOffPayload {
  days: RequestTimeOffDay[];
  actionWid: string;
}

export interface RequestTimeOffResult {
  hcmReferenceId: string;
  days: Array<{ date: string; entryId: string }>;
}

export interface ValidDatesQuery {
  timeOffTypeId: string;
  dates: string[];
}

export interface ValidDatesResult {
  validDates: string[];
  invalidDates: string[];
}

export interface HcmClient {
  fetchEmployeeSnapshots(params: BatchParams): Promise<EmployeeSnapshotPage>;
  fetchEligibleAbsenceTypes(workerWID: string): Promise<HcmLeaveType[]>;
  fetchPolicies(workerWID: string, leaveTypes: HcmLeaveType[]): Promise<HcmPolicy[]>;
  fetchBalances(workerWID: string, effectiveDate: string): Promise<BalanceRow[]>;
  requestTimeOff(workerWID: string, payload: RequestTimeOffPayload): Promise<RequestTimeOffResult>;
  correctTimeOffEntry(workerWID: string, entryId: string): Promise<void>;
  getValidTimeOffDates(workerWID: string, query: ValidDatesQuery): Promise<ValidDatesResult>;
}

export class HcmUnavailableError extends Error {
  constructor(message = 'HCM unavailable') {
    super(message);
    this.name = 'HcmUnavailableError';
  }
}

export class HcmValidationError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = 'HcmValidationError';
    this.code = code;
  }
}
