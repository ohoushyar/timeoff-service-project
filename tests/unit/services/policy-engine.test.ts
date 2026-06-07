import { describe, it, expect } from 'vitest';
import { Decimal } from 'decimal.js';
import {
  resolvePolicy,
  checkEligibility,
  allowsNegativeBalance,
  buildApprovalChain,
  computeDurationDays,
  datesOverlap,
  type PolicyWithRules,
} from '../../../src/services/policy-engine';
import { EmploymentStatus } from '@prisma/client';

const employee = {
  id: 'emp-1',
  department: 'Engineering',
  employmentStatus: 'ACTIVE' as EmploymentStatus,
  managerId: 'mgr-1',
  lastSyncedAt: new Date('2020-01-01'),
};

const policies: PolicyWithRules[] = [
  {
    id: 'p1',
    externalPolicyId: 'ext-1',
    leaveTypeId: 'lt-1',
    name: 'General',
    effectiveFrom: new Date('2020-01-01'),
    effectiveTo: null,
    location: null,
    department: null,
    employmentType: null,
    minTenureDays: null,
    isActive: true,
    lastSyncedAt: new Date(),
    createdAt: new Date(),
    updatedAt: new Date(),
    rules: [
      { id: 'r1', policyId: 'p1', ruleType: 'negative_balance', config: { allowed: false }, priority: 0 },
    ],
  },
  {
    id: 'p2',
    externalPolicyId: 'ext-2',
    leaveTypeId: 'lt-1',
    name: 'NY Eng',
    effectiveFrom: new Date('2020-01-01'),
    effectiveTo: null,
    location: 'US-NY',
    department: 'Engineering',
    employmentType: null,
    minTenureDays: null,
    isActive: true,
    lastSyncedAt: new Date(),
    createdAt: new Date(),
    updatedAt: new Date(),
    rules: [],
  },
];

describe('policy-engine', () => {
  it('resolves most specific policy', () => {
    const p = resolvePolicy(policies, employee, 'lt-1', 'US-NY');
    expect(p?.id).toBe('p2');
  });

  it('checkEligibility fails for inactive', () => {
    expect(checkEligibility({ ...employee, employmentStatus: 'TERMINATED' }, policies[0])).toBe(false);
  });

  it('allowsNegativeBalance reads rule', () => {
    expect(allowsNegativeBalance(policies[0])).toBe(false);
  });

  it('buildApprovalChain returns single manager', () => {
    const chain = buildApprovalChain(employee, { id: 'mgr-1', employmentStatus: 'ACTIVE' });
    expect(chain).toHaveLength(1);
    expect(chain[0].approverEmployeeId).toBe('mgr-1');
  });

  it('computeDurationDays for full week minus weekend', () => {
    const start = new Date(2026, 6, 6); // Mon Jul 6 local
    const end = new Date(2026, 6, 10); // Fri Jul 10 local
    const days = computeDurationDays(start, end, 'NONE', null, [], 'US-NY');
    expect(days.toNumber()).toBe(5);
  });

  it('computeDurationDays AM is 0.5', () => {
    const d = new Date('2026-07-10');
    expect(computeDurationDays(d, d, 'AM', null, []).toNumber()).toBe(0.5);
  });

  it('datesOverlap detects overlap', () => {
    expect(
      datesOverlap(new Date('2026-07-01'), new Date('2026-07-05'), new Date('2026-07-03'), new Date('2026-07-10')),
    ).toBe(true);
  });
});
