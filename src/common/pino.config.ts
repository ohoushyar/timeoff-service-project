import type { Options } from 'pino-http';
import type { Env } from '../config/env.js';
import { resolveCorrelationId } from './correlation-id.js';

function redactHeaders(headers: Record<string, unknown>): Record<string, unknown> {
  const copy = { ...headers };
  if (copy.authorization) copy.authorization = '[Redacted]';
  if (copy.Authorization) copy.Authorization = '[Redacted]';
  return copy;
}

export function createPinoHttpOptions(env: Env): Options {
  return {
    level: env.LOG_LEVEL,
    genReqId: (req) => resolveCorrelationId(req.headers['x-correlation-id']),
    customProps: (req) => ({
      correlationId: req.id,
    }),
    serializers: {
      req: (req) => ({
        id: req.id,
        method: req.method,
        url: req.url,
        correlationId: req.id,
        headers: redactHeaders(req.headers as Record<string, unknown>),
      }),
      res: (res) => ({
        statusCode: res.statusCode,
      }),
    },
    customSuccessMessage: (req, res) => `${req.method} ${req.url} ${res.statusCode}`,
    customErrorMessage: (req, res, err) =>
      `${req.method} ${req.url} ${res.statusCode} - ${err.message}`,
  };
}
