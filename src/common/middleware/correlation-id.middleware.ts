import { Injectable, NestMiddleware } from '@nestjs/common';
import type { NextFunction, Response } from 'express';
import type { AuthenticatedRequest } from '../../auth/authenticated-request.js';
import { resolveCorrelationId } from '../correlation-id.js';

@Injectable()
export class CorrelationIdMiddleware implements NestMiddleware {
  use(req: AuthenticatedRequest, res: Response, next: NextFunction): void {
    const pinoId = (req as AuthenticatedRequest & { id?: string }).id;
    const correlationId =
      pinoId ?? resolveCorrelationId(req.headers['x-correlation-id']);
    req.correlationId = correlationId;
    res.setHeader('X-Correlation-Id', correlationId);
    next();
  }
}
