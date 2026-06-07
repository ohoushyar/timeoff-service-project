import type { FastifyInstance } from 'fastify';
import { requireRole } from '../../auth/guards.js';
import { Roles } from '../../auth/roles.js';
import { runTimeOffSync, getSyncStatus } from '../../services/sync.service.js';
import { createHcmClient } from '../../integrations/hcm/workday/workday.adapter.js';
import { serializeSyncStatus } from '../../serializers/jsonapi/resources/sync-status.js';
import { JSON_API_CONTENT_TYPE } from '../../plugins/jsonapi.js';

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
      const result = await runTimeOffSync(app.prisma, hcm, {
        syncType: 'bootstrap',
        correlationId: request.correlationId,
        actorId: request.user.sub,
        actorRole: request.user.roles?.[0],
      });
      return reply.status(201).type(JSON_API_CONTENT_TYPE).send({
        jsonapi: { version: '1.1' },
        data: {
          type: 'sync-runs',
          id: result.syncRunId,
          attributes: result,
        },
        meta: { correlationId: request.correlationId },
      });
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
