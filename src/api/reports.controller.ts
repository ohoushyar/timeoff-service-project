import { Controller, Get, Header, Inject, Query, Req, UseGuards } from '@nestjs/common';
import { AuthorizationService } from '../auth/authorization.service.js';
import type { AuthenticatedRequest } from '../auth/authenticated-request.js';
import { JwtAuthGuard } from '../auth/jwt-auth.guard.js';
import { RolesGuard } from '../auth/roles.guard.js';
import { RequireRoles } from '../auth/roles.decorator.js';
import { Roles } from '../auth/roles.js';
import { JSON_API_CONTENT_TYPE } from '../common/constants.js';
import { AppError } from '../errors/app-error.js';
import { parsePagination } from '../lib/pagination.js';
import { PrismaService } from '../prisma/prisma.service.js';
import {
  getAuditReport,
  getLeaveUsageReport,
  getTeamCalendarReport,
  parseReportFilters,
} from '../services/report.service.js';
import {
  serializeAuditReport,
  serializeLeaveUsageReport,
  serializeTeamCalendarReport,
} from '../serializers/jsonapi/resources/reports.js';

interface ReportFiltersInput {
  startDate?: string;
  endDate?: string;
  department?: string;
  employeeId?: string;
  teamId?: string;
}

@Controller()
@UseGuards(JwtAuthGuard)
export class ReportsController {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(AuthorizationService) private readonly authorization: AuthorizationService,
  ) {}

  private async resolveTeamScope(
    req: AuthenticatedRequest,
    filter?: ReportFiltersInput,
  ): Promise<string[] | undefined> {
    if (this.authorization.isPrivileged(req.user)) {
      if (filter?.teamId) {
        const reports = await this.prisma.employeeHcmMapping.findMany({
          where: { managerId: filter.teamId },
          select: { id: true },
        });
        return [filter.teamId, ...reports.map((r) => r.id)];
      }
      return undefined;
    }

    if (!this.authorization.hasRole(req.user, 'manager') || !req.user.employeeId) {
      throw new AppError('FORBIDDEN');
    }

    const reports = await this.prisma.employeeHcmMapping.findMany({
      where: { managerId: req.user.employeeId },
      select: { id: true },
    });
    const teamIds = [req.user.employeeId, ...reports.map((r) => r.id)];

    if (filter?.employeeId) {
      if (!teamIds.includes(filter.employeeId)) throw new AppError('FORBIDDEN');
      return [filter.employeeId];
    }

    return teamIds;
  }

  @Get('/api/v1/reports/leave-usage')
  @UseGuards(RolesGuard)
  @RequireRoles(Roles.MANAGER, Roles.HR_ADMIN, Roles.SYSTEM_ADMIN)
  @Header('Content-Type', JSON_API_CONTENT_TYPE)
  async leaveUsage(@Req() req: AuthenticatedRequest, @Query() query: Record<string, unknown>) {
    const filters = parseReportFilters(query);
    const filter = query.filter as ReportFiltersInput | undefined;

    if (this.authorization.isPrivileged(req.user)) {
      // hr_admin+ can query org-wide or filtered
    } else if (this.authorization.hasRole(req.user, 'manager')) {
      filters.teamEmployeeIds = await this.resolveTeamScope(req, filter);
    } else {
      throw new AppError('FORBIDDEN');
    }

    const report = await getLeaveUsageReport(this.prisma, filters);
    return serializeLeaveUsageReport(report.rows, report.summary);
  }

  @Get('/api/v1/reports/team-calendar')
  @UseGuards(RolesGuard)
  @RequireRoles(Roles.MANAGER, Roles.HR_ADMIN, Roles.SYSTEM_ADMIN)
  @Header('Content-Type', JSON_API_CONTENT_TYPE)
  async teamCalendar(@Req() req: AuthenticatedRequest, @Query() query: Record<string, unknown>) {
    const filters = parseReportFilters(query);
    const filter = query.filter as ReportFiltersInput | undefined;
    filters.teamEmployeeIds = await this.resolveTeamScope(req, filter);

    const report = await getTeamCalendarReport(this.prisma, filters);
    return serializeTeamCalendarReport(report.rows, report.summary);
  }

  @Get('/api/v1/reports/audit')
  @UseGuards(RolesGuard)
  @RequireRoles(Roles.HR_ADMIN, Roles.SYSTEM_ADMIN)
  @Header('Content-Type', JSON_API_CONTENT_TYPE)
  async audit(@Query() query: Record<string, unknown>) {
    const filters = parseReportFilters(query);
    const { pageNumber, pageSize } = parsePagination(query);
    const report = await getAuditReport(this.prisma, filters, pageNumber, pageSize);
    return serializeAuditReport(report.rows, {
      basePath: '/api/v1/reports/audit',
      pageNumber,
      pageSize,
      totalCount: report.totalCount,
    });
  }
}
