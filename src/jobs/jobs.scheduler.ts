import { Inject, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { SchedulerRegistry } from '@nestjs/schedule';
import { CronJob } from 'cron';
import { AppConfigService } from '../config/app-config.service.js';
import { ApprovalReminderService } from './approval-reminder.service.js';
import { HcmApprovalRetryService } from './hcm-approval-retry.service.js';
import { NightlyHcmSyncService } from './nightly-hcm-sync.service.js';

@Injectable()
export class JobsScheduler implements OnModuleInit {
  private readonly logger = new Logger(JobsScheduler.name);

  constructor(
    @Inject(SchedulerRegistry) private readonly schedulerRegistry: SchedulerRegistry,
    @Inject(AppConfigService) private readonly config: AppConfigService,
    @Inject(NightlyHcmSyncService) private readonly nightlyHcmSync: NightlyHcmSyncService,
    @Inject(HcmApprovalRetryService) private readonly hcmApprovalRetry: HcmApprovalRetryService,
    @Inject(ApprovalReminderService) private readonly approvalReminder: ApprovalReminderService,
  ) {}

  onModuleInit(): void {
    this.registerJob('nightly-hcm-sync', this.config.env.CRON_NIGHTLY_HCM_SYNC, () =>
      this.nightlyHcmSync.run(),
    );
    this.registerJob('hcm-approval-retry', this.config.env.CRON_HCM_APPROVAL_RETRY, () =>
      this.hcmApprovalRetry.run(),
    );
    this.registerJob('approval-reminder', this.config.env.CRON_APPROVAL_REMINDER, () =>
      this.approvalReminder.run(),
    );
  }

  private registerJob(
    name: string,
    expression: string,
    handler: () => Promise<unknown>,
  ): void {
    const job = new CronJob(expression, () => {
      handler().catch((err) => this.logger.error(err, `${name} failed`));
    });
    this.schedulerRegistry.addCronJob(name, job);
    job.start();
  }
}
