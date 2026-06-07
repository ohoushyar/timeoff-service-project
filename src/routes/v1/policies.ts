import type { FastifyInstance } from 'fastify';
import { requireRole } from '../../auth/guards.js';
import { Roles } from '../../auth/roles.js';
import { listPolicies } from '../../services/policy.service.js';
import { serializePolicies } from '../../serializers/jsonapi/resources/policies.js';
import { JSON_API_CONTENT_TYPE } from '../../plugins/jsonapi.js';
import { parsePagination } from './leave-types.js';

export async function policyRoutes(app: FastifyInstance): Promise<void> {
  app.get(
    '/api/v1/policies',
    {
      preHandler: [app.authenticate, requireRole(Roles.HR_ADMIN, Roles.SYSTEM_ADMIN)],
    },
    async (request, reply) => {
      const { pageNumber, pageSize } = parsePagination(request.query as Record<string, unknown>);
      const { items, totalCount } = await listPolicies(app.prisma, pageNumber, pageSize);
      return reply.type(JSON_API_CONTENT_TYPE).send(
        serializePolicies(items, {
          basePath: '/api/v1/policies',
          pageNumber,
          pageSize,
          totalCount,
        }),
      );
    },
  );
}
