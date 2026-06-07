import type { Env } from '../../../config/env.js';
import type {
  HcmClient,
  BatchParams,
  EmployeeSnapshotPage,
  HcmLeaveType,
  HcmPolicy,
  BalanceRow,
  RequestTimeOffPayload,
  RequestTimeOffResult,
  ValidDatesQuery,
  ValidDatesResult,
} from '../types.js';
import { WorkdayHttpClient } from './workday.client.js';

interface WorkdayWorkerRow {
  id: string;
  descriptor?: string;
  email?: string;
  manager?: { id?: string };
  department?: { descriptor?: string };
  employmentStatus?: string;
}

interface WorkdayWorkersResponse {
  data: WorkdayWorkerRow[];
  total: number;
}

interface WorkdayBalanceRow {
  absencePlan?: { id?: string; descriptor?: string };
  unit?: { descriptor?: string };
  quantity?: string;
  category?: { descriptor?: string };
  effectiveDate?: string;
  position?: { location?: { id?: string } };
}

interface WorkdayBalancesResponse {
  data: WorkdayBalanceRow[];
  total: number;
}

interface WorkdayAbsenceTypeRow {
  id: string;
  descriptor?: string;
  paid?: boolean;
  requiresApproval?: boolean;
}

export class WorkdayAdapter implements HcmClient {
  private readonly http: WorkdayHttpClient;

  constructor(env: Env, fetchFn?: typeof fetch) {
    this.http = new WorkdayHttpClient({ env, fetchFn });
  }

  async fetchEmployeeSnapshots(params: BatchParams): Promise<EmployeeSnapshotPage> {
    const offset = params.offset ?? 0;
    const limit = params.limit ?? 100;
    const res = await this.http.get<WorkdayWorkersResponse>(
      `/absenceManagement/v5/workers?offset=${offset}&limit=${limit}`,
    );
    const data = (res.data ?? []).map((w) => ({
      externalEmployeeId: w.id,
      email: w.email ?? `${w.id}@example.com`,
      managerExternalEmployeeId: w.manager?.id,
      department: w.department?.descriptor,
      employmentStatus: mapEmploymentStatus(w.employmentStatus),
    }));
    return {
      data,
      total: res.total ?? data.length,
      hasMore: offset + data.length < (res.total ?? data.length),
    };
  }

  async fetchEligibleAbsenceTypes(workerWID: string): Promise<HcmLeaveType[]> {
    const res = await this.http.get<{ data: WorkdayAbsenceTypeRow[] }>(
      `/absenceManagement/v5/workers/${workerWID}/eligibleAbsenceTypes`,
    );
    return (res.data ?? []).map((t) => ({
      externalLeaveTypeId: t.id,
      code: slugify(t.descriptor ?? t.id),
      name: t.descriptor ?? t.id,
      isPaid: t.paid ?? true,
      requiresApproval: t.requiresApproval ?? true,
    }));
  }

  async fetchPolicies(workerWID: string, leaveTypes: HcmLeaveType[]): Promise<HcmPolicy[]> {
    return leaveTypes.map((lt) => ({
      externalPolicyId: `policy-${lt.externalLeaveTypeId}`,
      externalLeaveTypeId: lt.externalLeaveTypeId,
      name: `${lt.name} Policy`,
      effectiveFrom: new Date('2020-01-01').toISOString(),
      rules: [
        {
          ruleType: 'negative_balance',
          config: { allowed: false, maxNegativeDays: 0 },
          priority: 0,
        },
        {
          ruleType: 'eligibility',
          config: { minTenureDays: 0, employmentTypes: ['full_time'], locations: [] },
          priority: 0,
        },
      ],
    }));
  }

  async fetchBalances(workerWID: string, effectiveDate: string): Promise<BalanceRow[]> {
    const res = await this.http.get<WorkdayBalancesResponse>(
      `/absenceManagement/v5/balances?worker=${workerWID}&effective=${effectiveDate}`,
    );
    return (res.data ?? []).map((b) => ({
      externalLeaveTypeId: b.absencePlan?.id ?? 'unknown',
      dimensions: b.position?.location?.id ? { locationId: b.position.location.id } : {},
      currentBalance: parseFloat(b.quantity ?? '0'),
      unit: (b.unit?.descriptor ?? 'days').toLowerCase().includes('hour') ? 'hours' : 'days',
      hcmUpdatedAt: b.effectiveDate,
    }));
  }

  async requestTimeOff(
    workerWID: string,
    payload: RequestTimeOffPayload,
  ): Promise<RequestTimeOffResult> {
    const body = {
      businessProcessParameters: {
        action: { id: payload.actionWid },
      },
      days: payload.days.map((d) => ({
        date: d.date,
        timeOffType: { id: d.timeOffTypeId },
        dailyQuantity: d.quantity,
      })),
    };
    const res = (await this.http.postMultipart(
      `/absenceManagement/v5/workers/${workerWID}/requestTimeOff`,
      body,
    )) as { days?: Array<{ date?: string; id?: string }> };
    const days = (res.days ?? []).map((d, i) => ({
      date: d.date ?? payload.days[i]?.date ?? '',
      entryId: d.id ?? `entry-${Date.now()}-${i}`,
    }));
    return {
      hcmReferenceId: days[0]?.entryId ?? `entry-${Date.now()}`,
      days,
    };
  }

  async correctTimeOffEntry(_workerWID: string, _entryId: string): Promise<void> {
    // Phase 2
  }

  async getValidTimeOffDates(_workerWID: string, query: ValidDatesQuery): Promise<ValidDatesResult> {
    return { validDates: query.dates, invalidDates: [] };
  }
}

function mapEmploymentStatus(status?: string): EmployeeSnapshotPage['data'][0]['employmentStatus'] {
  const s = (status ?? 'ACTIVE').toUpperCase();
  if (s.includes('TERMIN')) return 'TERMINATED';
  if (s.includes('LEAVE')) return 'ON_LEAVE';
  if (s.includes('INACTIVE')) return 'INACTIVE';
  return 'ACTIVE';
}

function slugify(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '') || 'leave_type';
}

export function createHcmClient(env: Env, fetchFn?: typeof fetch): HcmClient {
  return new WorkdayAdapter(env, fetchFn);
}
