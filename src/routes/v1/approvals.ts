import type { FastifyInstance } from 'fastify';
import { requireRole } from '../../auth/guards.js';
import { Roles } from '../../auth/roles.js';
import {
  listPendingApprovals,
  approveLeaveRequest,
  rejectLeaveRequest,
} from '../../services/approval.service.js';
import { createHcmClient } from '../../integrations/hcm/workday/workday.adapter.js';
import { serializeApprovals } from '../../serializers/jsonapi/resources/approvals.js';
import { serializeLeaveRequest } from '../../serializers/jsonapi/resources/leave-requests.js';
import { JSON_API_CONTENT_TYPE } from '../../plugins/jsonapi.js';
import { parsePagination } from './leave-types.js';
import { paramId } from '../../lib/params.js';

export async function approvalRoutes(app: FastifyInstance): Promise<void> {
  app.get(
    '/api/v1/approvals/pending',
    {
      preHandler: [app.authenticate, requireRole(Roles.MANAGER, Roles.HR_ADMIN, Roles.SYSTEM_ADMIN)],
    },
    async (request, reply) => {
      const approverId = request.user.employeeId;
      if (!approverId) throw new Error('employeeId required');
      const { pageNumber, pageSize } = parsePagination(request.query as Record<string, unknown>);
      const { items, totalCount } = await listPendingApprovals(
        app.prisma,
        approverId,
        pageNumber,
        pageSize,
      );
      return reply.type(JSON_API_CONTENT_TYPE).send(
        serializeApprovals(items, {
          basePath: '/api/v1/approvals/pending',
          pageNumber,
          pageSize,
          totalCount,
        }),
      );
    },
  );

  app.post(
    '/api/v1/leave-requests/:id/approve',
    { preHandler: [app.authenticate] },
    async (request, reply) => {
      const body = request.body as { data?: { attributes?: { comment?: string } } };
      const approverId = request.user.employeeId;
      if (!approverId) throw new Error('employeeId required');
      const hcm = createHcmClient(app.config);
      const result = await approveLeaveRequest(
        app.prisma,
        hcm,
        app.config,
        paramId(request),
        approverId,
        body.data?.attributes?.comment,
        {
          id: request.user.sub,
          role: request.user.roles?.[0],
          correlationId: request.correlationId,
        },
      );
      return reply.type(JSON_API_CONTENT_TYPE).send(serializeLeaveRequest(result));
    },
  );

  app.post(
    '/api/v1/leave-requests/:id/reject',
    { preHandler: [app.authenticate] },
    async (request, reply) => {
      const body = request.body as { data?: { attributes?: { comment?: string } } };
      const approverId = request.user.employeeId;
      if (!approverId) throw new Error('employeeId required');
      const result = await rejectLeaveRequest(
        app.prisma,
        paramId(request),
        approverId,
        body.data?.attributes?.comment,
        {
          id: request.user.sub,
          role: request.user.roles?.[0],
          correlationId: request.correlationId,
        },
      );
      return reply.type(JSON_API_CONTENT_TYPE).send(serializeLeaveRequest(result));
    },
  );
}
