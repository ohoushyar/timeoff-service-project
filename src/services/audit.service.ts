import type { PrismaClient, AuditAction } from '@prisma/client';

const PII_FIELDS = ['email'];

function redactPii(value: unknown): unknown {
  if (value === null || value === undefined) return value;
  if (Array.isArray(value)) return value.map(redactPii);
  if (typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    const result: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(obj)) {
      if (PII_FIELDS.includes(key)) continue;
      result[key] = redactPii(val);
    }
    return result;
  }
  return value;
}

export interface AuditParams {
  action: AuditAction;
  actorId?: string;
  actorRole?: string;
  resourceType: string;
  resourceId: string;
  before?: unknown;
  after?: unknown;
  correlationId?: string;
}

export async function writeAudit(prisma: PrismaClient, params: AuditParams): Promise<void> {
  await prisma.auditLog.create({
    data: {
      action: params.action,
      actorId: params.actorId,
      actorRole: params.actorRole,
      resourceType: params.resourceType,
      resourceId: params.resourceId,
      before: params.before ? (redactPii(params.before) as object) : undefined,
      after: params.after ? (redactPii(params.after) as object) : undefined,
      correlationId: params.correlationId,
    },
  });
}

export { redactPii };
