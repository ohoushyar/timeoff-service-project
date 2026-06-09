import {
  Body,
  Controller,
  Get,
  Header,
  HttpCode,
  Inject,
  Param,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { AuthenticatedRequest } from '../auth/authenticated-request.js';
import { JwtAuthGuard } from '../auth/jwt-auth.guard.js';
import { RolesGuard } from '../auth/roles.guard.js';
import { RequireRoles } from '../auth/roles.decorator.js';
import { Roles } from '../auth/roles.js';
import { JSON_API_CONTENT_TYPE } from '../common/constants.js';
import { AppConfigService } from '../config/app-config.service.js';
import { createHcmClient } from '../integrations/hcm/workday/workday.adapter.js';
import { parsePagination } from '../lib/pagination.js';
import { paramId } from '../lib/params.js';
import { PrismaService } from '../prisma/prisma.service.js';
import {
  approveLeaveRequest,
  listPendingApprovals,
  rejectLeaveRequest,
} from '../services/approval.service.js';
import { getIdempotencyKey, withIdempotency } from '../services/idempotency.service.js';
import { serializeApprovals } from '../serializers/jsonapi/resources/approvals.js';
import { serializeLeaveRequest } from '../serializers/jsonapi/resources/leave-requests.js';

@Controller()
@UseGuards(JwtAuthGuard)
export class ApprovalsController {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(AppConfigService) private readonly config: AppConfigService,
  ) {}

  @Get('/api/v1/approvals/pending')
  @UseGuards(RolesGuard)
  @RequireRoles(Roles.MANAGER, Roles.HR_ADMIN, Roles.SYSTEM_ADMIN)
  @Header('Content-Type', JSON_API_CONTENT_TYPE)
  async listPending(@Req() req: AuthenticatedRequest, @Query() query: Record<string, unknown>) {
    const approverId = req.user.employeeId;
    if (!approverId) throw new Error('employeeId required');
    const { pageNumber, pageSize } = parsePagination(query);
    const { items, totalCount } = await listPendingApprovals(
      this.prisma,
      approverId,
      pageNumber,
      pageSize,
    );
    return serializeApprovals(items, {
      basePath: '/api/v1/approvals/pending',
      pageNumber,
      pageSize,
      totalCount,
    });
  }

  @Post('/api/v1/leave-requests/:id/approve')
  @HttpCode(200)
  @Header('Content-Type', JSON_API_CONTENT_TYPE)
  async approve(
    @Req() req: AuthenticatedRequest,
    @Param() params: { id: string },
    @Body() body: { data?: { attributes?: { comment?: string } } },
  ) {
    const leaveRequestId = paramId(params);
    const approverId = req.user.employeeId;
    if (!approverId) throw new Error('employeeId required');
    const hcm = createHcmClient(this.config.env);
    const idempotencyKey = getIdempotencyKey(req.headers as Record<string, unknown>);
    const idempotent = await withIdempotency(
      this.prisma,
      `POST /api/v1/leave-requests/${leaveRequestId}/approve`,
      idempotencyKey,
      body ?? {},
      async () => {
        const approved = await approveLeaveRequest(
          this.prisma,
          hcm,
          this.config.env,
          leaveRequestId,
          approverId,
          body.data?.attributes?.comment,
          {
            id: req.user.sub,
            role: req.user.roles?.[0],
            correlationId: req.correlationId,
          },
        );
        return {
          statusCode: 200,
          body: serializeLeaveRequest(approved) as unknown as Record<string, unknown>,
        };
      },
    );
    return idempotent.body;
  }

  @Post('/api/v1/leave-requests/:id/reject')
  @HttpCode(200)
  @Header('Content-Type', JSON_API_CONTENT_TYPE)
  async reject(
    @Req() req: AuthenticatedRequest,
    @Param() params: { id: string },
    @Body() body: { data?: { attributes?: { comment?: string } } },
  ) {
    const leaveRequestId = paramId(params);
    const approverId = req.user.employeeId;
    if (!approverId) throw new Error('employeeId required');
    const idempotencyKey = getIdempotencyKey(req.headers as Record<string, unknown>);
    const idempotent = await withIdempotency(
      this.prisma,
      `POST /api/v1/leave-requests/${leaveRequestId}/reject`,
      idempotencyKey,
      body ?? {},
      async () => {
        const rejected = await rejectLeaveRequest(
          this.prisma,
          leaveRequestId,
          approverId,
          body.data?.attributes?.comment,
          {
            id: req.user.sub,
            role: req.user.roles?.[0],
            correlationId: req.correlationId,
          },
        );
        return {
          statusCode: 200,
          body: serializeLeaveRequest(rejected) as unknown as Record<string, unknown>,
        };
      },
    );
    return idempotent.body;
  }
}
