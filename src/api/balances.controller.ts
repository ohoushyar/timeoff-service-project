import { Controller, Get, Header, Inject, Param, Query, Req, UseGuards } from '@nestjs/common';
import { AuthorizationService } from '../auth/authorization.service.js';
import type { AuthenticatedRequest } from '../auth/authenticated-request.js';
import { JwtAuthGuard } from '../auth/jwt-auth.guard.js';
import { JSON_API_CONTENT_TYPE } from '../common/constants.js';
import { AppConfigService } from '../config/app-config.service.js';
import { createHcmClient } from '../integrations/hcm/workday/workday.adapter.js';
import { parsePagination } from '../lib/pagination.js';
import { paramId } from '../lib/params.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { getEmployeeBalances } from '../services/balance.service.js';
import { serializeBalances } from '../serializers/jsonapi/resources/balances.js';
import { serializeLedgerEntries } from '../serializers/jsonapi/resources/ledger.js';

@Controller()
@UseGuards(JwtAuthGuard)
export class BalancesController {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(AppConfigService) private readonly config: AppConfigService,
    @Inject(AuthorizationService) private readonly authorization: AuthorizationService,
  ) {}

  @Get('/api/v1/employees/:id/balances')
  @Header('Content-Type', JSON_API_CONTENT_TYPE)
  async balances(
    @Req() req: AuthenticatedRequest,
    @Param() params: { id: string },
    @Query() query: Record<string, unknown>,
  ) {
    const id = paramId(params);
    if (this.authorization.isPrivileged(req.user)) {
      await this.authorization.requireSelfOrPrivileged(req.user, id);
    } else {
      await this.authorization.requireManagerOfOrPrivileged(req.user, id);
    }
    const hcm = createHcmClient(this.config.env);
    const balances = await getEmployeeBalances(this.prisma, hcm, id, {
      refreshFromHcm: true,
    });
    const { pageNumber, pageSize } = parsePagination(query);
    return serializeBalances(balances, {
      basePath: `/api/v1/employees/${id}/balances`,
      pageNumber,
      pageSize,
      totalCount: balances.length,
    });
  }

  @Get('/api/v1/employees/:id/balance-ledger')
  @Header('Content-Type', JSON_API_CONTENT_TYPE)
  async balanceLedger(
    @Req() req: AuthenticatedRequest,
    @Param() params: { id: string },
    @Query() query: Record<string, unknown>,
  ) {
    const id = paramId(params);
    if (this.authorization.isPrivileged(req.user)) {
      await this.authorization.requireSelfOrPrivileged(req.user, id);
    } else {
      await this.authorization.requireManagerOfOrPrivileged(req.user, id);
    }
    const { pageNumber, pageSize } = parsePagination(query);
    const where = { employeeId: id };
    const [items, totalCount] = await Promise.all([
      this.prisma.leaveBalanceLedger.findMany({
        where,
        skip: (pageNumber - 1) * pageSize,
        take: pageSize,
        orderBy: { effectiveAt: 'desc' },
      }),
      this.prisma.leaveBalanceLedger.count({ where }),
    ]);
    return serializeLedgerEntries(items, {
      basePath: `/api/v1/employees/${id}/balance-ledger`,
      pageNumber,
      pageSize,
      totalCount,
    });
  }
}
