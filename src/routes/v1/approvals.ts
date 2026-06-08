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
import { withIdempotency, getIdempotencyKey } from '../../services/idempotency.service.js';

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
      const leaveRequestId = paramId(request);
      const body = request.body as { data?: { attributes?: { comment?: string } } };
      const approverId = request.user.employeeId;
      if (!approverId) throw new Error('employeeId required');
      const hcm = createHcmClient(app.config);
      const idempotencyKey = getIdempotencyKey(request.headers as Record<string, unknown>);
      const idempotent = await withIdempotency(
        app.prisma,
        `POST /api/v1/leave-requests/${leaveRequestId}/approve`,
        idempotencyKey,
        request.body ?? {},
        async () => {
          const approved = await approveLeaveRequest(
            app.prisma,
            hcm,
            app.config,
            leaveRequestId,
            approverId,
            body.data?.attributes?.comment,
            {
              id: request.user.sub,
              role: request.user.roles?.[0],
              correlationId: request.correlationId,
            },
          );
          return {
            statusCode: 200,
            body: serializeLeaveRequest(approved) as unknown as Record<string, unknown>,
          };
        },
      );
      return reply.type(JSON_API_CONTENT_TYPE).send(idempotent.body);
    },
  );

  app.post(
    '/api/v1/leave-requests/:id/reject',
    { preHandler: [app.authenticate] },
    async (request, reply) => {
      const leaveRequestId = paramId(request);
      const body = request.body as { data?: { attributes?: { comment?: string } } };
      const approverId = request.user.employeeId;
      if (!approverId) throw new Error('employeeId required');
      const idempotencyKey = getIdempotencyKey(request.headers as Record<string, unknown>);
      const idempotent = await withIdempotency(
        app.prisma,
        `POST /api/v1/leave-requests/${leaveRequestId}/reject`,
        idempotencyKey,
        request.body ?? {},
        async () => {
          const rejected = await rejectLeaveRequest(
            app.prisma,
            leaveRequestId,
            approverId,
            body.data?.attributes?.comment,
            {
              id: request.user.sub,
              role: request.user.roles?.[0],
              correlationId: request.correlationId,
            },
          );
          return {
            statusCode: 200,
            body: serializeLeaveRequest(rejected) as unknown as Record<string, unknown>,
          };
        },
      );
      return reply.type(JSON_API_CONTENT_TYPE).send(idempotent.body);
    },
  );
}
