import crypto from 'node:crypto';
import type { PrismaClient } from '@prisma/client';
import { AppError } from '../errors/app-error.js';
import { toJsonValue } from '../lib/json.js';

const TTL_MS = 24 * 60 * 60 * 1000;

export function hashRequestBody(body: unknown): string {
  return crypto.createHash('sha256').update(stableStringify(body)).digest('hex');
}

function stableStringify(value: unknown): string {
  if (value === null || value === undefined) return 'null';
  if (typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(',')}]`;
  }
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(obj[k])}`).join(',')}}`;
}

export async function withIdempotency<T extends Record<string, unknown>>(
  prisma: PrismaClient,
  route: string,
  idempotencyKey: string | undefined,
  requestBody: unknown,
  handler: () => Promise<{ statusCode: number; body: T }>,
): Promise<{ statusCode: number; body: T }> {
  if (!idempotencyKey) {
    return handler();
  }

  const requestHash = hashRequestBody(requestBody);
  const existing = await prisma.idempotencyKey.findUnique({
    where: { key: idempotencyKey },
  });

  if (existing) {
    if (existing.expiresAt < new Date()) {
      await prisma.idempotencyKey.delete({ where: { id: existing.id } });
    } else if (existing.route === route && existing.requestHash === requestHash) {
      return {
        statusCode: existing.statusCode,
        body: existing.responseBody as T,
      };
    } else {
      throw new AppError('IDEMPOTENCY_CONFLICT');
    }
  }

  const result = await handler();

  await prisma.idempotencyKey.create({
    data: {
      key: idempotencyKey,
      route,
      requestHash,
      responseBody: toJsonValue(result.body),
      statusCode: result.statusCode,
      expiresAt: new Date(Date.now() + TTL_MS),
    },
  });

  return result;
}

export function getIdempotencyKey(headers: Record<string, unknown>): string | undefined {
  const raw = headers['idempotency-key'] ?? headers['Idempotency-Key'];
  if (typeof raw === 'string' && raw.length > 0) return raw;
  if (Array.isArray(raw) && typeof raw[0] === 'string') return raw[0];
  return undefined;
}
