import { Inject, Injectable } from '@nestjs/common';
import { AppError } from '../errors/app-error.js';
import { PrismaService } from '../prisma/prisma.service.js';
import type { JwtPayload, Role } from './roles.js';

@Injectable()
export class AuthorizationService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  requireAuth(user?: JwtPayload): void {
    if (!user) {
      throw new AppError('AUTHENTICATION_REQUIRED');
    }
  }

  requireRole(user: JwtPayload, ...allowed: Role[]): void {
    this.requireAuth(user);
    const roles = user.roles ?? [];
    if (!allowed.some((r) => roles.includes(r))) {
      throw new AppError('FORBIDDEN');
    }
  }

  hasRole(user: JwtPayload, role: Role): boolean {
    return (user.roles ?? []).includes(role);
  }

  isPrivileged(user: JwtPayload): boolean {
    const roles = user.roles ?? [];
    return roles.includes('hr_admin') || roles.includes('system_admin');
  }

  async requireSelfOrPrivileged(user: JwtPayload, targetEmployeeId: string): Promise<void> {
    this.requireAuth(user);
    if (this.isPrivileged(user)) return;
    if (user.employeeId === targetEmployeeId) return;
    throw new AppError('FORBIDDEN');
  }

  async requireManagerOfOrPrivileged(
    user: JwtPayload,
    targetEmployeeId: string,
  ): Promise<void> {
    this.requireAuth(user);
    if (this.isPrivileged(user)) return;
    if (user.employeeId === targetEmployeeId) return;

    const target = await this.prisma.employeeHcmMapping.findUnique({
      where: { id: targetEmployeeId },
      select: { managerId: true },
    });
    if (target?.managerId === user.employeeId) return;
    throw new AppError('FORBIDDEN');
  }
}
