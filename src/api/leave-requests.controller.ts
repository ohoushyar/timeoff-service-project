import {
  Body,
  Controller,
  Get,
  Header,
  HttpCode,
  Inject,
  Param,
  Patch,
  Post,
  Query,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { PartialDayType } from '@prisma/client';
import type { Response } from 'express';
import { AuthorizationService } from '../auth/authorization.service.js';
import type { AuthenticatedRequest } from '../auth/authenticated-request.js';
import { JwtAuthGuard } from '../auth/jwt-auth.guard.js';
import { JSON_API_CONTENT_TYPE } from '../common/constants.js';
import { AppConfigService } from '../config/app-config.service.js';
import { AppError } from '../errors/app-error.js';
import { createHcmClient } from '../integrations/hcm/workday/workday.adapter.js';
import { parsePagination } from '../lib/pagination.js';
import { paramId } from '../lib/params.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { getIdempotencyKey, withIdempotency } from '../services/idempotency.service.js';
import {
  cancelLeaveRequest,
  createLeaveRequest,
  getLeaveRequest,
  listLeaveRequests,
  updateLeaveRequest,
} from '../services/leave-request.service.js';
import {
  serializeLeaveRequest,
  serializeLeaveRequests,
} from '../serializers/jsonapi/resources/leave-requests.js';

@Controller()
@UseGuards(JwtAuthGuard)
export class LeaveRequestsController {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(AppConfigService) private readonly config: AppConfigService,
    @Inject(AuthorizationService) private readonly authorization: AuthorizationService,
  ) {}

  @Post('/api/v1/leave-requests')
  @Header('Content-Type', JSON_API_CONTENT_TYPE)
  async create(
    @Req() req: AuthenticatedRequest,
    @Body() body: {
      data?: {
        attributes?: Record<string, unknown>;
        relationships?: {
          employee?: { data?: { id?: string } };
          leaveType?: { data?: { id?: string } };
        };
      };
    },
    @Res({ passthrough: true }) res: Response,
  ) {
    const attrs = body.data?.attributes ?? {};
    const employeeId =
      body.data?.relationships?.employee?.data?.id ?? req.user.employeeId;
    const leaveTypeId = body.data?.relationships?.leaveType?.data?.id;

    if (!employeeId || !leaveTypeId) {
      throw new AppError('VALIDATION_ERROR', 'employee and leaveType relationships required');
    }

    if (!this.authorization.isPrivileged(req.user) && employeeId !== req.user.employeeId) {
      throw new AppError('FORBIDDEN');
    }

    const hcm = createHcmClient(this.config.env);
    const idempotencyKey = getIdempotencyKey(req.headers as Record<string, unknown>);
    const idempotent = await withIdempotency(
      this.prisma,
      'POST /api/v1/leave-requests',
      idempotencyKey,
      body,
      async () => {
        const created = await createLeaveRequest(
          this.prisma,
          hcm,
          this.config.env,
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
            id: req.user.sub,
            role: req.user.roles?.[0],
            correlationId: req.correlationId,
          },
        );
        return {
          statusCode: 201,
          body: serializeLeaveRequest(created) as unknown as Record<string, unknown>,
        };
      },
    );

    res.status(idempotent.statusCode);
    return idempotent.body;
  }

  @Get('/api/v1/leave-requests')
  @Header('Content-Type', JSON_API_CONTENT_TYPE)
  async list(@Req() req: AuthenticatedRequest, @Query() query: Record<string, unknown>) {
    const filter = query.filter as Record<string, string> | undefined;
    const { pageNumber, pageSize } = parsePagination(query);

    let employeeId = filter?.employeeId;
    let employeeIds: string[] | undefined;

    if (this.authorization.isPrivileged(req.user)) {
      employeeId = filter?.employeeId;
    } else if (this.authorization.hasRole(req.user, 'manager') && req.user.employeeId) {
      const reports = await this.prisma.employeeHcmMapping.findMany({
        where: { managerId: req.user.employeeId },
        select: { id: true },
      });
      const teamIds = [req.user.employeeId, ...reports.map((r) => r.id)];
      if (filter?.employeeId) {
        if (!teamIds.includes(filter.employeeId)) {
          throw new AppError('FORBIDDEN');
        }
        employeeId = filter.employeeId;
      } else {
        employeeIds = teamIds;
      }
    } else {
      if (filter?.employeeId && filter.employeeId !== req.user.employeeId) {
        throw new AppError('FORBIDDEN');
      }
      employeeId = req.user.employeeId;
    }

    const { items, totalCount } = await listLeaveRequests(this.prisma, {
      employeeId,
      employeeIds,
      status: filter?.status,
      page: pageNumber,
      pageSize,
    });

    return serializeLeaveRequests(items, {
      basePath: '/api/v1/leave-requests',
      pageNumber,
      pageSize,
      totalCount,
    });
  }

  @Get('/api/v1/leave-requests/:id')
  @Header('Content-Type', JSON_API_CONTENT_TYPE)
  async getOne(@Req() req: AuthenticatedRequest, @Param() params: { id: string }) {
    const result = await getLeaveRequest(this.prisma, paramId(params));
    if (!this.authorization.isPrivileged(req.user)) {
      await this.authorization.requireManagerOfOrPrivileged(req.user, result.employeeId);
    }
    return serializeLeaveRequest(result);
  }

  @Patch('/api/v1/leave-requests/:id')
  @Header('Content-Type', JSON_API_CONTENT_TYPE)
  async update(
    @Req() req: AuthenticatedRequest,
    @Param() params: { id: string },
    @Body() body: { data?: { attributes?: Record<string, unknown> } },
  ) {
    const existing = await getLeaveRequest(this.prisma, paramId(params));
    if (!this.authorization.isPrivileged(req.user) && existing.employeeId !== req.user.employeeId) {
      throw new AppError('FORBIDDEN');
    }

    const attrs = body.data?.attributes ?? {};

    const result = await updateLeaveRequest(
      this.prisma,
      paramId(params),
      {
        startDate: attrs.startDate ? new Date(String(attrs.startDate)) : undefined,
        endDate: attrs.endDate ? new Date(String(attrs.endDate)) : undefined,
        partialDayType: attrs.partialDay as PartialDayType | undefined,
        partialDayHours: attrs.partialDayHours as number | undefined,
        dimensions: attrs.dimensions as Record<string, unknown> | undefined,
        reason: attrs.reason as string | undefined,
      },
      {
        id: req.user.sub,
        role: req.user.roles?.[0],
        correlationId: req.correlationId,
      },
    );

    return serializeLeaveRequest(result);
  }

  @Post('/api/v1/leave-requests/:id/cancel')
  @HttpCode(200)
  @Header('Content-Type', JSON_API_CONTENT_TYPE)
  async cancel(
    @Req() req: AuthenticatedRequest,
    @Param() params: { id: string },
    @Body() body: unknown,
  ) {
    const existing = await getLeaveRequest(this.prisma, paramId(params));
    if (!this.authorization.isPrivileged(req.user) && existing.employeeId !== req.user.employeeId) {
      throw new AppError('FORBIDDEN');
    }
    const requestId = paramId(params);
    const hcm = createHcmClient(this.config.env);
    const idempotencyKey = getIdempotencyKey(req.headers as Record<string, unknown>);
    const idempotent = await withIdempotency(
      this.prisma,
      `POST /api/v1/leave-requests/${requestId}/cancel`,
      idempotencyKey,
      body ?? {},
      async () => {
        const cancelled = await cancelLeaveRequest(this.prisma, hcm, requestId, {
          id: req.user.sub,
          role: req.user.roles?.[0],
          correlationId: req.correlationId,
        });
        return {
          statusCode: 200,
          body: serializeLeaveRequest(cancelled) as unknown as Record<string, unknown>,
        };
      },
    );
    return idempotent.body;
  }
}
