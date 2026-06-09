import type { Request } from 'express';
import type { JwtPayload } from './roles.js';

export interface AuthenticatedRequest extends Request {
  user: JwtPayload;
  correlationId: string;
}
