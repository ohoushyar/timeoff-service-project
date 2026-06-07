import type { PrismaClient } from '@prisma/client';
import { AppError } from '../errors/app-error.js';

export async function getEmployee(prisma: PrismaClient, id: string) {
  const employee = await prisma.employeeHcmMapping.findUnique({ where: { id } });
  if (!employee) throw new AppError('EMPLOYEE_NOT_FOUND');
  return employee;
}
