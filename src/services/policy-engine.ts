import type {
  EmployeeHcmMapping,
  LeavePolicy,
  LeavePolicyRule,
  LeaveType,
  EmploymentStatus,
} from '@prisma/client';
import { Decimal } from 'decimal.js';
import { AppError } from '../errors/app-error.js';

export interface PolicyWithRules extends LeavePolicy {
  rules: LeavePolicyRule[];
}

export interface EmployeeContext {
  id: string;
  department?: string | null;
  employmentStatus: EmploymentStatus;
  managerId?: string | null;
  lastSyncedAt: Date;
}

export function resolvePolicy(
  policies: PolicyWithRules[],
  employee: EmployeeContext,
  leaveTypeId: string,
  location?: string,
): PolicyWithRules | null {
  const candidates = policies.filter(
    (p) =>
      p.leaveTypeId === leaveTypeId &&
      p.isActive &&
      (!p.department || p.department === employee.department) &&
      (!p.location || p.location === location),
  );

  candidates.sort((a, b) => specificityScore(b) - specificityScore(a));
  return candidates[0] ?? null;
}

function specificityScore(p: LeavePolicy): number {
  let score = 0;
  if (p.location) score += 4;
  if (p.department) score += 2;
  if (p.employmentType) score += 1;
  return score;
}

export function checkEligibility(
  employee: EmployeeContext,
  policy: PolicyWithRules | null,
): boolean {
  if (employee.employmentStatus !== 'ACTIVE') return false;
  if (!policy) return true;

  const rule = policy.rules.find((r) => r.ruleType === 'eligibility');
  if (!rule) return true;

  const config = rule.config as { minTenureDays?: number };
  if (config.minTenureDays) {
    const tenureDays = Math.floor(
      (Date.now() - employee.lastSyncedAt.getTime()) / (1000 * 60 * 60 * 24),
    );
    if (tenureDays < config.minTenureDays) return false;
  }
  return true;
}

export function allowsNegativeBalance(policy: PolicyWithRules | null): boolean {
  if (!policy) return false;
  const rule = policy.rules.find((r) => r.ruleType === 'negative_balance');
  if (!rule) return false;
  const config = rule.config as { allowed?: boolean };
  return config.allowed === true;
}

export function buildApprovalChain(
  employee: EmployeeContext,
  manager?: Pick<EmployeeHcmMapping, 'id' | 'employmentStatus'> | null,
): { approverEmployeeId: string; approvalLevel: number }[] {
  if (!employee.managerId || !manager) {
    throw new AppError('APPROVER_NOT_FOUND', 'Manager not found in employee snapshot');
  }
  if (manager.employmentStatus !== 'ACTIVE') {
    throw new AppError('APPROVER_NOT_FOUND', 'Manager is inactive');
  }
  return [{ approverEmployeeId: employee.managerId, approvalLevel: 1 }];
}

export interface HolidayEntry {
  date: Date;
  location?: string | null;
  isActive: boolean;
}

export function computeDurationDays(
  startDate: Date,
  endDate: Date,
  partialDayType: 'NONE' | 'AM' | 'PM' | 'HOURS',
  partialDayHours: number | null,
  holidays: HolidayEntry[],
  location?: string,
  standardDayHours = 8,
): Decimal {
  if (startDate > endDate) {
    throw new AppError('INVALID_DATE_RANGE');
  }

  if (partialDayType === 'AM' || partialDayType === 'PM') {
    if (startDate.toDateString() !== endDate.toDateString()) {
      throw new AppError('INVALID_DATE_RANGE', 'Partial day must be single date');
    }
    return new Decimal(0.5);
  }

  if (partialDayType === 'HOURS') {
    const hours = partialDayHours ?? 0;
    return new Decimal(hours).div(standardDayHours);
  }

  let days = 0;
  const cursor = new Date(startDate);
  while (cursor <= endDate) {
    const dow = cursor.getDay();
    if (dow !== 0 && dow !== 6 && !isHoliday(cursor, holidays, location)) {
      days++;
    }
    cursor.setDate(cursor.getDate() + 1);
  }
  if (days === 0) {
    throw new AppError('INVALID_LEAVE_DAY', 'No business days in range');
  }
  return new Decimal(days);
}

function isHoliday(date: Date, holidays: HolidayEntry[], location?: string): boolean {
  return holidays.some((h) => {
    if (!h.isActive) return false;
    if (h.location && location && h.location !== location) return false;
    return h.date.toDateString() === date.toDateString();
  });
}

export function datesOverlap(
  aStart: Date,
  aEnd: Date,
  bStart: Date,
  bEnd: Date,
): boolean {
  return aStart <= bEnd && bStart <= aEnd;
}

export function requiresDocumentation(
  policy: PolicyWithRules | null,
  durationDays: Decimal,
): boolean {
  if (!policy) return false;
  const rule = policy.rules.find((r) => r.ruleType === 'documentation');
  if (!rule) return false;
  const config = rule.config as { requiredAfterConsecutiveDays?: number };
  return (
    config.requiredAfterConsecutiveDays !== undefined &&
    durationDays.gte(config.requiredAfterConsecutiveDays)
  );
}

export type { LeaveType };
