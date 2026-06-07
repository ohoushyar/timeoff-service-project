import { describe, it, expect } from 'vitest';
import { mapWorkdayErrorCode, parseWorkdayError } from '../../../../src/integrations/hcm/workday/error-mapping.js';

describe('Workday error mapping', () => {
  it('maps A1011 to HCM_INSUFFICIENT_BALANCE', () => {
    expect(mapWorkdayErrorCode('A1011')).toBe('HCM_INSUFFICIENT_BALANCE');
  });

  it('maps A1008 to OVERLAPPING_REQUEST', () => {
    expect(mapWorkdayErrorCode('A1008')).toBe('OVERLAPPING_REQUEST');
  });

  it('maps A1051 to INVALID_WORKFLOW_TRANSITION', () => {
    expect(mapWorkdayErrorCode('A1051')).toBe('INVALID_WORKFLOW_TRANSITION');
  });

  it('defaults unknown codes to HCM_VALIDATION_ERROR', () => {
    expect(mapWorkdayErrorCode('UNKNOWN')).toBe('HCM_VALIDATION_ERROR');
  });

  it('parses Workday errors array', () => {
    const parsed = parseWorkdayError({
      errors: [{ code: 'A1011', error: 'Insufficient balance' }],
    });
    expect(parsed.code).toBe('A1011');
  });
});
