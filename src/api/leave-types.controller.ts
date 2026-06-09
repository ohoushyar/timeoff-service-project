import { Controller, Get, Header, Inject, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard.js';
import { JSON_API_CONTENT_TYPE } from '../common/constants.js';
import { parsePagination } from '../lib/pagination.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { listLeaveTypes } from '../services/leave-type.service.js';
import { serializeLeaveTypes } from '../serializers/jsonapi/resources/leave-types.js';

@Controller()
@UseGuards(JwtAuthGuard)
export class LeaveTypesController {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  @Get('/api/v1/leave-types')
  @Header('Content-Type', JSON_API_CONTENT_TYPE)
  async list(@Query() query: Record<string, unknown>) {
    const { pageNumber, pageSize } = parsePagination(query);
    const { items, totalCount } = await listLeaveTypes(this.prisma, pageNumber, pageSize);
    return serializeLeaveTypes(items, {
      basePath: '/api/v1/leave-types',
      pageNumber,
      pageSize,
      totalCount,
    });
  }
}
