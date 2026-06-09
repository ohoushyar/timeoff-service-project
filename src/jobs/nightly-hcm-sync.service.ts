import { Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { AppConfigService } from '../config/app-config.service.js';
import { createHcmClient } from '../integrations/hcm/workday/workday.adapter.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { runTimeOffSync } from '../services/sync.service.js';

@Injectable()
export class NightlyHcmSyncService {
  private readonly logger = new Logger(NightlyHcmSyncService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: AppConfigService,
  ) {}

  async run(): Promise<void> {
    const state = await this.prisma.timeOffSyncState.findFirst();
    if (state?.syncInProgress) {
      this.logger.warn('Skipping nightly sync — already in progress');
      return;
    }

    const hcm = createHcmClient(this.config.env);
    await runTimeOffSync(this.prisma, hcm, {
      syncType: 'nightly',
      correlationId: randomUUID(),
    });
  }
}
