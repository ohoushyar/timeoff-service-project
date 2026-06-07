import type { ErrorCode } from '../../../errors/error-codes.js';

const WORKDAY_ERROR_MAP: Record<string, ErrorCode> = {
  A1011: 'HCM_INSUFFICIENT_BALANCE',
  A1041: 'POLICY_VIOLATION',
  A1026: 'POLICY_VIOLATION',
  A1790: 'EMPLOYEE_INACTIVE',
  A1008: 'OVERLAPPING_REQUEST',
  A1028: 'OVERLAPPING_REQUEST',
  A1042: 'OVERLAPPING_REQUEST',
  A1038: 'HCM_VALIDATION_ERROR',
  A1017: 'HCM_VALIDATION_ERROR',
  A1016: 'HCM_VALIDATION_ERROR',
  A1020: 'HCM_VALIDATION_ERROR',
  A1051: 'INVALID_WORKFLOW_TRANSITION',
};

export function mapWorkdayErrorCode(code: string): ErrorCode {
  return WORKDAY_ERROR_MAP[code] ?? 'HCM_VALIDATION_ERROR';
}

export function parseWorkdayError(body: unknown): { code: string; message: string } {
  if (typeof body === 'object' && body !== null) {
    const obj = body as Record<string, unknown>;
    const errors = obj.errors as Array<{ code?: string; error?: string }> | undefined;
    if (errors?.[0]) {
      return {
        code: errors[0].code ?? 'UNKNOWN',
        message: errors[0].error ?? 'Workday validation error',
      };
    }
    if (typeof obj.error === 'string') {
      return { code: (obj.code as string) ?? 'UNKNOWN', message: obj.error };
    }
  }
  return { code: 'UNKNOWN', message: 'Unknown Workday error' };
}
