import {
  Body,
  Controller,
  Get,
  Header,
  Inject,
  Post,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { Response } from 'express';
import type { AuthenticatedRequest } from '../auth/authenticated-request.js';
import { JwtAuthGuard } from '../auth/jwt-auth.guard.js';
import { RolesGuard } from '../auth/roles.guard.js';
import { RequireRoles } from '../auth/roles.decorator.js';
import { Roles } from '../auth/roles.js';
import { JSON_API_CONTENT_TYPE } from '../common/constants.js';
import { AppConfigService } from '../config/app-config.service.js';
import { createHcmClient } from '../integrations/hcm/workday/workday.adapter.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { getIdempotencyKey, withIdempotency } from '../services/idempotency.service.js';
import { getSyncStatus, runTimeOffSync } from '../services/sync.service.js';
import { serializeSyncStatus } from '../serializers/jsonapi/resources/sync-status.js';

@Controller()
@UseGuards(JwtAuthGuard)
export class SyncController {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(AppConfigService) private readonly config: AppConfigService,
  ) {}

  @Post('/api/v1/sync/time-off')
  @UseGuards(RolesGuard)
  @RequireRoles(Roles.SYSTEM_ADMIN, Roles.INTEGRATION_CLIENT)
  @Header('Content-Type', JSON_API_CONTENT_TYPE)
  async syncTimeOff(
    @Req() req: AuthenticatedRequest,
    @Body() body: unknown,
    @Res({ passthrough: true }) res: Response,
  ) {
    const hcm = createHcmClient(this.config.env);
    const idempotencyKey = getIdempotencyKey(req.headers as Record<string, unknown>);
    const idempotent = await withIdempotency(
      this.prisma,
      'POST /api/v1/sync/time-off',
      idempotencyKey,
      body ?? {},
      async () => {
        const result = await runTimeOffSync(this.prisma, hcm, {
          syncType: 'bootstrap',
          correlationId: req.correlationId,
          actorId: req.user.sub,
          actorRole: req.user.roles?.[0],
        });
        const responseBody = {
          jsonapi: { version: '1.1' as const },
          data: {
            type: 'sync-runs',
            id: result.syncRunId,
            attributes: result,
          },
          meta: { correlationId: req.correlationId },
        };
        return { statusCode: 201, body: responseBody as Record<string, unknown> };
      },
    );
    res.status(idempotent.statusCode);
    return idempotent.body;
  }

  @Get('/api/v1/sync/status')
  @UseGuards(RolesGuard)
  @RequireRoles(Roles.HR_ADMIN, Roles.SYSTEM_ADMIN, Roles.INTEGRATION_CLIENT)
  @Header('Content-Type', JSON_API_CONTENT_TYPE)
  async syncStatus() {
    const status = await getSyncStatus(this.prisma);
    return serializeSyncStatus(status);
  }
}
