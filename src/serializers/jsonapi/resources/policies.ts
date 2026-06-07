import type { LeavePolicy } from '@prisma/client';
import { omitNulls, collectionDocument } from '../document.js';

export function serializePolicies(
  items: LeavePolicy[],
  opts: { basePath: string; pageNumber: number; pageSize: number; totalCount: number },
) {
  return collectionDocument(
    'policies',
    items.map((p) => ({
      id: p.id,
      attributes: omitNulls({
        externalPolicyId: p.externalPolicyId,
        name: p.name,
        effectiveFrom: p.effectiveFrom.toISOString(),
        effectiveTo: p.effectiveTo?.toISOString(),
        location: p.location,
        department: p.department,
        employmentType: p.employmentType,
        minTenureDays: p.minTenureDays,
        isActive: p.isActive,
      }) as Record<string, unknown>,
      relationships: {
        leaveType: { data: { type: 'leave-types', id: p.leaveTypeId } },
      },
    })),
    opts,
  );
}
