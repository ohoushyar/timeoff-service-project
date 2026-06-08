import type { FastifyInstance } from 'fastify';
import { requireRole } from '../../auth/guards.js';
import { Roles } from '../../auth/roles.js';
import { listSyncRuns, getSyncRun } from '../../services/sync-run.service.js';
import { serializeSyncRun, serializeSyncRuns } from '../../serializers/jsonapi/resources/sync-runs.js';
import { JSON_API_CONTENT_TYPE } from '../../plugins/jsonapi.js';
import { parsePagination } from './leave-types.js';
import { paramId } from '../../lib/params.js';

export async function syncRunRoutes(app: FastifyInstance): Promise<void> {
  app.get(
    '/api/v1/sync-runs',
    {
      preHandler: [
        app.authenticate,
        requireRole(Roles.HR_ADMIN, Roles.SYSTEM_ADMIN, Roles.INTEGRATION_CLIENT),
      ],
    },
    async (request, reply) => {
      const { pageNumber, pageSize } = parsePagination(request.query as Record<string, unknown>);
      const { items, totalCount } = await listSyncRuns(app.prisma, pageNumber, pageSize);
      return reply.type(JSON_API_CONTENT_TYPE).send(
        serializeSyncRuns(items, {
          basePath: '/api/v1/sync-runs',
          pageNumber,
          pageSize,
          totalCount,
        }),
      );
    },
  );

  app.get(
    '/api/v1/sync-runs/:id',
    {
      preHandler: [
        app.authenticate,
        requireRole(Roles.HR_ADMIN, Roles.SYSTEM_ADMIN, Roles.INTEGRATION_CLIENT),
      ],
    },
    async (request, reply) => {
      const run = await getSyncRun(app.prisma, paramId(request));
      return reply.type(JSON_API_CONTENT_TYPE).send(serializeSyncRun(run));
    },
  );
}
