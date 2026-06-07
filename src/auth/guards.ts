import type { FastifyReply, FastifyRequest } from 'fastify';
import { AppError } from '../errors/app-error.js';
import type { Role } from './roles.js';

export function requireAuth(request: FastifyRequest, _reply: FastifyReply): void {
  if (!request.user) {
    throw new AppError('AUTHENTICATION_REQUIRED');
  }
}

export function requireRole(...allowed: Role[]) {
  return async (request: FastifyRequest, _reply: FastifyReply): Promise<void> => {
    requireAuth(request, _reply);
    const roles = request.user.roles ?? [];
    if (!allowed.some((r) => roles.includes(r))) {
      throw new AppError('FORBIDDEN');
    }
  };
}

export function hasRole(request: FastifyRequest, role: Role): boolean {
  return (request.user?.roles ?? []).includes(role);
}

export function isPrivileged(request: FastifyRequest): boolean {
  const roles = request.user?.roles ?? [];
  return roles.includes('hr_admin') || roles.includes('system_admin');
}

export async function requireSelfOrPrivileged(
  request: FastifyRequest,
  _reply: FastifyReply,
  targetEmployeeId: string,
): Promise<void> {
  requireAuth(request, _reply);
  if (isPrivileged(request)) return;
  if (request.user.employeeId === targetEmployeeId) return;
  throw new AppError('FORBIDDEN');
}

export async function requireManagerOfOrPrivileged(
  request: FastifyRequest,
  _reply: FastifyReply,
  targetEmployeeId: string,
): Promise<void> {
  requireAuth(request, _reply);
  if (isPrivileged(request)) return;
  if (request.user.employeeId === targetEmployeeId) return;

  const prisma = request.server.prisma;
  const target = await prisma.employeeHcmMapping.findUnique({
    where: { id: targetEmployeeId },
    select: { managerId: true },
  });
  if (target?.managerId === request.user.employeeId) return;
  throw new AppError('FORBIDDEN');
}
