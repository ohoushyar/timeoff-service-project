import { Controller, Get, Header, Inject, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard.js';
import { RolesGuard } from '../auth/roles.guard.js';
import { RequireRoles } from '../auth/roles.decorator.js';
import { Roles } from '../auth/roles.js';
import { JSON_API_CONTENT_TYPE } from '../common/constants.js';
import { parsePagination } from '../lib/pagination.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { listPolicies } from '../services/policy.service.js';
import { serializePolicies } from '../serializers/jsonapi/resources/policies.js';

@Controller()
@UseGuards(JwtAuthGuard)
export class PoliciesController {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  @Get('/api/v1/policies')
  @UseGuards(RolesGuard)
  @RequireRoles(Roles.HR_ADMIN, Roles.SYSTEM_ADMIN)
  @Header('Content-Type', JSON_API_CONTENT_TYPE)
  async list(@Query() query: Record<string, unknown>) {
    const { pageNumber, pageSize } = parsePagination(query);
    const { items, totalCount } = await listPolicies(this.prisma, pageNumber, pageSize);
    return serializePolicies(items, {
      basePath: '/api/v1/policies',
      pageNumber,
      pageSize,
      totalCount,
    });
  }
}
