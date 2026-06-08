import type { FastifyInstance } from 'fastify';
import { requireRole } from '../../auth/guards.js';
import { Roles } from '../../auth/roles.js';
import { runTimeOffSync, getSyncStatus } from '../../services/sync.service.js';
import { createHcmClient } from '../../integrations/hcm/workday/workday.adapter.js';
import { serializeSyncStatus } from '../../serializers/jsonapi/resources/sync-status.js';
import { JSON_API_CONTENT_TYPE } from '../../plugins/jsonapi.js';
import { withIdempotency, getIdempotencyKey } from '../../services/idempotency.service.js';

export async function syncRoutes(app: FastifyInstance): Promise<void> {
  app.post(
    '/api/v1/sync/time-off',
    {
      preHandler: [
        app.authenticate,
        requireRole(Roles.SYSTEM_ADMIN, Roles.INTEGRATION_CLIENT),
      ],
    },
    async (request, reply) => {
      const hcm = createHcmClient(app.config);
      const idempotencyKey = getIdempotencyKey(request.headers as Record<string, unknown>);
      const idempotent = await withIdempotency(
        app.prisma,
        'POST /api/v1/sync/time-off',
        idempotencyKey,
        request.body ?? {},
        async () => {
          const result = await runTimeOffSync(app.prisma, hcm, {
            syncType: 'bootstrap',
            correlationId: request.correlationId,
            actorId: request.user.sub,
            actorRole: request.user.roles?.[0],
          });
          const body = {
            jsonapi: { version: '1.1' as const },
            data: {
              type: 'sync-runs',
              id: result.syncRunId,
              attributes: result,
            },
            meta: { correlationId: request.correlationId },
          };
          return { statusCode: 201, body: body as Record<string, unknown> };
        },
      );
      return reply
        .status(idempotent.statusCode)
        .type(JSON_API_CONTENT_TYPE)
        .send(idempotent.body);
    },
  );

  app.get(
    '/api/v1/sync/status',
    {
      preHandler: [app.authenticate, requireRole(Roles.HR_ADMIN, Roles.SYSTEM_ADMIN, Roles.INTEGRATION_CLIENT)],
    },
    async (request, reply) => {
      const status = await getSyncStatus(app.prisma);
      return reply.type(JSON_API_CONTENT_TYPE).send(serializeSyncStatus(status));
    },
  );
}
