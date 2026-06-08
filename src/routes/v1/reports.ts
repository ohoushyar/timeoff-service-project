import type { FastifyInstance } from 'fastify';
import { hasRole, isPrivileged, requireRole } from '../../auth/guards.js';
import { Roles } from '../../auth/roles.js';
import { AppError } from '../../errors/app-error.js';
import {
  parseReportFilters,
  getLeaveUsageReport,
  getTeamCalendarReport,
  getAuditReport,
} from '../../services/report.service.js';
import {
  serializeLeaveUsageReport,
  serializeTeamCalendarReport,
  serializeAuditReport,
} from '../../serializers/jsonapi/resources/reports.js';
import { JSON_API_CONTENT_TYPE } from '../../plugins/jsonapi.js';
import { parsePagination } from './leave-types.js';

async function resolveTeamScope(
  app: FastifyInstance,
  request: import('fastify').FastifyRequest,
  filter?: ReportFiltersInput,
): Promise<string[] | undefined> {
  if (isPrivileged(request)) {
    if (filter?.teamId) {
      const reports = await app.prisma.employeeHcmMapping.findMany({
        where: { managerId: filter.teamId },
        select: { id: true },
      });
      return [filter.teamId, ...reports.map((r) => r.id)];
    }
    return undefined;
  }

  if (!hasRole(request, 'manager') || !request.user.employeeId) {
    throw new AppError('FORBIDDEN');
  }

  const reports = await app.prisma.employeeHcmMapping.findMany({
    where: { managerId: request.user.employeeId },
    select: { id: true },
  });
  const teamIds = [request.user.employeeId, ...reports.map((r) => r.id)];

  if (filter?.employeeId) {
    if (!teamIds.includes(filter.employeeId)) throw new AppError('FORBIDDEN');
    return [filter.employeeId];
  }

  return teamIds;
}

interface ReportFiltersInput {
  startDate?: string;
  endDate?: string;
  department?: string;
  employeeId?: string;
  teamId?: string;
}

export async function reportRoutes(app: FastifyInstance): Promise<void> {
  app.get(
    '/api/v1/reports/leave-usage',
    {
      preHandler: [
        app.authenticate,
        requireRole(Roles.MANAGER, Roles.HR_ADMIN, Roles.SYSTEM_ADMIN),
      ],
    },
    async (request, reply) => {
      const query = request.query as Record<string, unknown>;
      const filters = parseReportFilters(query);
      const filter = query.filter as ReportFiltersInput | undefined;

      if (isPrivileged(request)) {
        // hr_admin+ can query org-wide or filtered
      } else if (hasRole(request, 'manager')) {
        filters.teamEmployeeIds = await resolveTeamScope(app, request, filter);
      } else {
        throw new AppError('FORBIDDEN');
      }

      const report = await getLeaveUsageReport(app.prisma, filters);
      return reply
        .type(JSON_API_CONTENT_TYPE)
        .send(serializeLeaveUsageReport(report.rows, report.summary));
    },
  );

  app.get(
    '/api/v1/reports/team-calendar',
    {
      preHandler: [
        app.authenticate,
        requireRole(Roles.MANAGER, Roles.HR_ADMIN, Roles.SYSTEM_ADMIN),
      ],
    },
    async (request, reply) => {
      const query = request.query as Record<string, unknown>;
      const filters = parseReportFilters(query);
      const filter = query.filter as ReportFiltersInput | undefined;
      filters.teamEmployeeIds = await resolveTeamScope(app, request, filter);

      const report = await getTeamCalendarReport(app.prisma, filters);
      return reply
        .type(JSON_API_CONTENT_TYPE)
        .send(serializeTeamCalendarReport(report.rows, report.summary));
    },
  );

  app.get(
    '/api/v1/reports/audit',
    {
      preHandler: [app.authenticate, requireRole(Roles.HR_ADMIN, Roles.SYSTEM_ADMIN)],
    },
    async (request, reply) => {
      const query = request.query as Record<string, unknown>;
      const filters = parseReportFilters(query);
      const { pageNumber, pageSize } = parsePagination(query);
      const report = await getAuditReport(app.prisma, filters, pageNumber, pageSize);
      return reply.type(JSON_API_CONTENT_TYPE).send(
        serializeAuditReport(report.rows, {
          basePath: '/api/v1/reports/audit',
          pageNumber,
          pageSize,
          totalCount: report.totalCount,
        }),
      );
    },
  );
}
