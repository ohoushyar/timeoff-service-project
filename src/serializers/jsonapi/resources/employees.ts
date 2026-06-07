import type { EmployeeHcmMapping } from '@prisma/client';
import { omitNulls, singleDocument, collectionDocument } from '../document.js';

export function serializeEmployee(employee: EmployeeHcmMapping) {
  return singleDocument('employees', employee.id, omitNulls({
    externalEmployeeId: employee.externalEmployeeId,
    department: employee.department,
    employmentStatus: employee.employmentStatus,
    lastSyncedAt: employee.lastSyncedAt.toISOString(),
    createdAt: employee.createdAt.toISOString(),
    updatedAt: employee.updatedAt.toISOString(),
  }), {
    manager: employee.managerId
      ? { data: { type: 'employees', id: employee.managerId } }
      : { data: null },
  });
}

export function serializeEmployees(
  employees: EmployeeHcmMapping[],
  opts: { basePath: string; pageNumber: number; pageSize: number; totalCount: number },
) {
  return collectionDocument(
    'employees',
    employees.map((e) => ({
      id: e.id,
      attributes: omitNulls({
        externalEmployeeId: e.externalEmployeeId,
        department: e.department,
        employmentStatus: e.employmentStatus,
        lastSyncedAt: e.lastSyncedAt.toISOString(),
      }) as Record<string, unknown>,
      relationships: {
        manager: e.managerId
          ? { data: { type: 'employees', id: e.managerId } }
          : { data: null },
      },
    })),
    opts,
  );
}
