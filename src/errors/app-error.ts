import { ErrorCodes, type ErrorCode } from './error-codes.js';

export interface JsonApiErrorObject {
  status: string;
  code: ErrorCode;
  title: string;
  detail: string;
  source?: { pointer?: string; parameter?: string };
}

export class AppError extends Error {
  readonly code: ErrorCode;
  readonly httpStatus: number;
  readonly detail: string;
  readonly source?: { pointer?: string; parameter?: string };

  constructor(
    code: ErrorCode,
    detail?: string,
    options?: { source?: { pointer?: string; parameter?: string } },
  ) {
    const def = ErrorCodes[code];
    super(detail ?? def.title);
    this.name = 'AppError';
    this.code = code;
    this.httpStatus = def.httpStatus;
    this.detail = detail ?? def.title;
    this.source = options?.source;
  }

  toJsonApiError(): JsonApiErrorObject {
    return {
      status: String(this.httpStatus),
      code: this.code,
      title: ErrorCodes[this.code].title,
      detail: this.detail,
      ...(this.source ? { source: this.source } : {}),
    };
  }
}

export function isAppError(err: unknown): err is AppError {
  return err instanceof AppError;
}
