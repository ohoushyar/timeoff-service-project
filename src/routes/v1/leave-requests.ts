import type { FastifyInstance } from 'fastify';
import type { PartialDayType } from '@prisma/client';
import { isPrivileged } from '../../auth/guards.js';
import {
  createLeaveRequest,
  cancelLeaveRequest,
  listLeaveRequests,
  getLeaveRequest,
} from '../../services/leave-request.service.js';
import { createHcmClient } from '../../integrations/hcm/workday/workday.adapter.js';
import {
  serializeLeaveRequest,
  serializeLeaveRequests,
} from '../../serializers/jsonapi/resources/leave-requests.js';
import { JSON_API_CONTENT_TYPE } from '../../plugins/jsonapi.js';
import { parsePagination } from './leave-types.js';
import { paramId } from '../../lib/params.js';
import { AppError } from '../../errors/app-error.js';

export async function leaveRequestRoutes(app: FastifyInstance): Promise<void> {
  app.post(
    '/api/v1/leave-requests',
    { preHandler: [app.authenticate] },
    async (request, reply) => {
      const body = request.body as {
        data?: {
          attributes?: Record<string, unknown>;
          relationships?: {
            employee?: { data?: { id?: string } };
            leaveType?: { data?: { id?: string } };
          };
        };
      };

      const attrs = body.data?.attributes ?? {};
      const employeeId =
        body.data?.relationships?.employee?.data?.id ?? request.user.employeeId;
      const leaveTypeId = body.data?.relationships?.leaveType?.data?.id;

      if (!employeeId || !leaveTypeId) {
        throw new AppError('VALIDATION_ERROR', 'employee and leaveType relationships required');
      }

      if (!isPrivileged(request) && employeeId !== request.user.employeeId) {
        throw new AppError('FORBIDDEN');
      }

      const hcm = createHcmClient(app.config);
      const result = await createLeaveRequest(
        app.prisma,
        hcm,
        app.config,
        {
          employeeId,
          leaveTypeId,
          startDate: new Date(String(attrs.startDate)),
          endDate: new Date(String(attrs.endDate)),
          partialDayType: (attrs.partialDay as PartialDayType) ?? 'NONE',
          partialDayHours: attrs.partialDayHours as number | undefined,
          dimensions: (attrs.dimensions as Record<string, unknown>) ?? {},
          reason: attrs.reason as string | undefined,
          submit: attrs.submit === true,
          documentationProvided: attrs.documentationProvided === true,
        },
        {
          id: request.user.sub,
          role: request.user.roles?.[0],
          correlationId: request.correlationId,
        },
      );

      return reply.status(201).type(JSON_API_CONTENT_TYPE).send(serializeLeaveRequest(result));
    },
  );

  app.get(
    '/api/v1/leave-requests',
    { preHandler: [app.authenticate] },
    async (request, reply) => {
      const query = request.query as Record<string, unknown>;
      const filter = query.filter as Record<string, string> | undefined;
      const { pageNumber, pageSize } = parsePagination(query);

      let employeeId = filter?.employeeId;
      if (!isPrivileged(request)) {
        employeeId = request.user.employeeId;
      }

      const { items, totalCount } = await listLeaveRequests(app.prisma, {
        employeeId,
        status: filter?.status,
        page: pageNumber,
        pageSize,
      });

      return reply.type(JSON_API_CONTENT_TYPE).send(
        serializeLeaveRequests(items, {
          basePath: '/api/v1/leave-requests',
          pageNumber,
          pageSize,
          totalCount,
        }),
      );
    },
  );

  app.get(
    '/api/v1/leave-requests/:id',
    { preHandler: [app.authenticate] },
    async (request, reply) => {
      const result = await getLeaveRequest(app.prisma, paramId(request));
      if (!isPrivileged(request) && result.employeeId !== request.user.employeeId) {
        throw new AppError('FORBIDDEN');
      }
      return reply.type(JSON_API_CONTENT_TYPE).send(serializeLeaveRequest(result));
    },
  );

  app.post(
    '/api/v1/leave-requests/:id/cancel',
    { preHandler: [app.authenticate] },
    async (request, reply) => {
      const existing = await getLeaveRequest(app.prisma, paramId(request));
      if (!isPrivileged(request) && existing.employeeId !== request.user.employeeId) {
        throw new AppError('FORBIDDEN');
      }
      const result = await cancelLeaveRequest(app.prisma, paramId(request), {
        id: request.user.sub,
        role: request.user.roles?.[0],
        correlationId: request.correlationId,
      });
      return reply.type(JSON_API_CONTENT_TYPE).send(serializeLeaveRequest(result));
    },
  );
}
