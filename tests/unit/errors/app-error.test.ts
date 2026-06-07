import { describe, it, expect } from 'vitest';
import { AppError } from '../../../src/errors/app-error';
import { ErrorCodes } from '../../../src/errors/error-codes';

describe('AppError', () => {
  it('maps error codes to HTTP status', () => {
    const err = new AppError('INSUFFICIENT_BALANCE', 'Not enough days');
    expect(err.httpStatus).toBe(422);
    expect(err.code).toBe('INSUFFICIENT_BALANCE');
  });

  it('produces JSON:API error shape', () => {
    const err = new AppError('NOT_FOUND', 'Missing resource', {
      source: { pointer: '/data/id' },
    });
    const json = err.toJsonApiError();
    expect(json.status).toBe('404');
    expect(json.code).toBe('NOT_FOUND');
    expect(json.source?.pointer).toBe('/data/id');
  });

  it('covers all error codes with valid status', () => {
    for (const code of Object.keys(ErrorCodes) as Array<keyof typeof ErrorCodes>) {
      const err = new AppError(code);
      expect(err.httpStatus).toBeGreaterThanOrEqual(400);
    }
  });
});
