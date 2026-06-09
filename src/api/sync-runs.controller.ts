import { Controller, Get, Header, Inject, Param, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard.js';
import { RolesGuard } from '../auth/roles.guard.js';
import { RequireRoles } from '../auth/roles.decorator.js';
import { Roles } from '../auth/roles.js';
import { JSON_API_CONTENT_TYPE } from '../common/constants.js';
import { parsePagination } from '../lib/pagination.js';
import { paramId } from '../lib/params.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { getSyncRun, listSyncRuns } from '../services/sync-run.service.js';
import { serializeSyncRun, serializeSyncRuns } from '../serializers/jsonapi/resources/sync-runs.js';

@Controller()
@UseGuards(JwtAuthGuard)
export class SyncRunsController {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  @Get('/api/v1/sync-runs')
  @UseGuards(RolesGuard)
  @RequireRoles(Roles.HR_ADMIN, Roles.SYSTEM_ADMIN, Roles.INTEGRATION_CLIENT)
  @Header('Content-Type', JSON_API_CONTENT_TYPE)
  async list(@Query() query: Record<string, unknown>) {
    const { pageNumber, pageSize } = parsePagination(query);
    const { items, totalCount } = await listSyncRuns(this.prisma, pageNumber, pageSize);
    return serializeSyncRuns(items, {
      basePath: '/api/v1/sync-runs',
      pageNumber,
      pageSize,
      totalCount,
    });
  }

  @Get('/api/v1/sync-runs/:id')
  @UseGuards(RolesGuard)
  @RequireRoles(Roles.HR_ADMIN, Roles.SYSTEM_ADMIN, Roles.INTEGRATION_CLIENT)
  @Header('Content-Type', JSON_API_CONTENT_TYPE)
  async getOne(@Param() params: { id: string }) {
    const run = await getSyncRun(this.prisma, paramId(params));
    return serializeSyncRun(run);
  }
}
