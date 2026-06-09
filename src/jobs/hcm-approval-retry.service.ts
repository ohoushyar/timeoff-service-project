import { Injectable, Logger } from '@nestjs/common';
import { AppConfigService } from '../config/app-config.service.js';
import { createHcmClient } from '../integrations/hcm/workday/workday.adapter.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { retryPendingHcmUpdates } from '../services/approval.service.js';

@Injectable()
export class HcmApprovalRetryService {
  private readonly logger = new Logger(HcmApprovalRetryService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: AppConfigService,
  ) {}

  async run(): Promise<void> {
    const hcm = createHcmClient(this.config.env);
    const result = await retryPendingHcmUpdates(this.prisma, hcm, this.config.env);
    this.logger.log(result, 'hcm-approval-retry completed');
  }
}
