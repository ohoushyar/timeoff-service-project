export const Roles = {
  EMPLOYEE: 'employee',
  MANAGER: 'manager',
  HR_ADMIN: 'hr_admin',
  SYSTEM_ADMIN: 'system_admin',
  INTEGRATION_CLIENT: 'integration_client',
} as const;

export type Role = (typeof Roles)[keyof typeof Roles];

export const ALL_ROLES: Role[] = Object.values(Roles);

export interface JwtPayload {
  sub: string;
  roles: Role[];
  employeeId?: string;
  iss?: string;
  aud?: string;
  exp?: number;
}

