import type { FastifyInstance } from 'fastify';
import type { PartialDayType } from '@prisma/client';
import { isPrivileged, hasRole, requireManagerOfOrPrivileged } from '../../auth/guards.js';
import {
  createLeaveRequest,
  cancelLeaveRequest,
  listLeaveRequests,
  getLeaveRequest,
  updateLeaveRequest,
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
      let employeeIds: string[] | undefined;

      if (isPrivileged(request)) {
        employeeId = filter?.employeeId;
      } else if (hasRole(request, 'manager') && request.user.employeeId) {
        const reports = await app.prisma.employeeHcmMapping.findMany({
          where: { managerId: request.user.employeeId },
          select: { id: true },
        });
        const teamIds = [request.user.employeeId, ...reports.map((r) => r.id)];
        if (filter?.employeeId) {
          if (!teamIds.includes(filter.employeeId)) {
            throw new AppError('FORBIDDEN');
          }
          employeeId = filter.employeeId;
        } else {
          employeeIds = teamIds;
        }
      } else {
        if (filter?.employeeId && filter.employeeId !== request.user.employeeId) {
          throw new AppError('FORBIDDEN');
        }
        employeeId = request.user.employeeId;
      }

      const { items, totalCount } = await listLeaveRequests(app.prisma, {
        employeeId,
        employeeIds,
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
      if (!isPrivileged(request)) {
        await requireManagerOfOrPrivileged(request, reply, result.employeeId);
      }
      return reply.type(JSON_API_CONTENT_TYPE).send(serializeLeaveRequest(result));
    },
  );

  app.patch(
    '/api/v1/leave-requests/:id',
    { preHandler: [app.authenticate] },
    async (request, reply) => {
      const existing = await getLeaveRequest(app.prisma, paramId(request));
      if (!isPrivileged(request) && existing.employeeId !== request.user.employeeId) {
        throw new AppError('FORBIDDEN');
      }

      const body = request.body as { data?: { attributes?: Record<string, unknown> } };
      const attrs = body.data?.attributes ?? {};

      const result = await updateLeaveRequest(
        app.prisma,
        paramId(request),
        {
          startDate: attrs.startDate ? new Date(String(attrs.startDate)) : undefined,
          endDate: attrs.endDate ? new Date(String(attrs.endDate)) : undefined,
          partialDayType: attrs.partialDay as PartialDayType | undefined,
          partialDayHours: attrs.partialDayHours as number | undefined,
          dimensions: attrs.dimensions as Record<string, unknown> | undefined,
          reason: attrs.reason as string | undefined,
        },
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
