import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import jwt from 'jsonwebtoken';
import { getEnv } from '../config/env.js';
import { AppError } from '../errors/app-error.js';
import type { AuthenticatedRequest } from './authenticated-request.js';
import type { JwtPayload } from './roles.js';

@Injectable()
export class JwtAuthGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const authHeader = request.headers.authorization;

    if (!authHeader?.startsWith('Bearer ')) {
      throw new AppError('AUTHENTICATION_REQUIRED');
    }

    const env = getEnv();
    try {
      const payload = jwt.verify(authHeader.slice(7), env.JWT_SECRET, {
        issuer: env.JWT_ISSUER,
        audience: env.JWT_AUDIENCE,
      }) as JwtPayload;
      request.user = payload;
      return true;
    } catch {
      throw new AppError('AUTHENTICATION_REQUIRED');
    }
  }
}
