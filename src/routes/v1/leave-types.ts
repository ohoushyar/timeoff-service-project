import type { FastifyInstance } from 'fastify';
import { listLeaveTypes } from '../../services/leave-type.service.js';
import { serializeLeaveTypes } from '../../serializers/jsonapi/resources/leave-types.js';
import { JSON_API_CONTENT_TYPE } from '../../plugins/jsonapi.js';

function parsePagination(query: Record<string, unknown>) {
  const page = query.page as Record<string, string> | undefined;
  const pageNumber = Math.max(1, Number(page?.number ?? 1));
  const pageSize = Math.min(100, Math.max(1, Number(page?.size ?? 25)));
  return { pageNumber, pageSize };
}

export async function leaveTypeRoutes(app: FastifyInstance): Promise<void> {
  app.get(
    '/api/v1/leave-types',
    { preHandler: [app.authenticate] },
    async (request, reply) => {
      const { pageNumber, pageSize } = parsePagination(request.query as Record<string, unknown>);
      const { items, totalCount } = await listLeaveTypes(app.prisma, pageNumber, pageSize);
      return reply.type(JSON_API_CONTENT_TYPE).send(
        serializeLeaveTypes(items, {
          basePath: '/api/v1/leave-types',
          pageNumber,
          pageSize,
          totalCount,
        }),
      );
    },
  );
}

export { parsePagination };
