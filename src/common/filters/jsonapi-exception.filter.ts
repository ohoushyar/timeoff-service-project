import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
} from '@nestjs/common';
import type { Response } from 'express';
import type { AuthenticatedRequest } from '../../auth/authenticated-request.js';
import { isAppError } from '../../errors/app-error.js';
import { JSON_API_CONTENT_TYPE } from '../constants.js';

@Catch()
export class JsonApiExceptionFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<AuthenticatedRequest>();
    const correlationId = request.correlationId ?? 'unknown';

    if (isAppError(exception)) {
      response.status(exception.httpStatus).type(JSON_API_CONTENT_TYPE).json({
        jsonapi: { version: '1.1' },
        errors: [exception.toJsonApiError()],
        meta: { correlationId },
      });
      return;
    }

    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const message = exception.message ?? 'Validation error';
      response.status(status).type(JSON_API_CONTENT_TYPE).json({
        jsonapi: { version: '1.1' },
        errors: [
          {
            status: String(status),
            code: 'VALIDATION_ERROR',
            title: 'Validation error',
            detail: message,
          },
        ],
        meta: { correlationId },
      });
      return;
    }

    request.log?.error({ err: exception }, 'Unhandled exception');
    response.status(500).type(JSON_API_CONTENT_TYPE).json({
      jsonapi: { version: '1.1' },
      errors: [
        {
          status: '500',
          code: 'VALIDATION_ERROR',
          title: 'Internal server error',
          detail: 'An unexpected error occurred',
        },
      ],
      meta: { correlationId },
    });
  }
}
