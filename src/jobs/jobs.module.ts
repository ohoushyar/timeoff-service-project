import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { AppConfigModule } from '../config/app-config.module.js';
import { ApprovalReminderService } from './approval-reminder.service.js';
import { HcmApprovalRetryService } from './hcm-approval-retry.service.js';
import { JobsScheduler } from './jobs.scheduler.js';
import { NightlyHcmSyncService } from './nightly-hcm-sync.service.js';

@Module({
  imports: [AppConfigModule, ScheduleModule.forRoot()],
  providers: [
    NightlyHcmSyncService,
    HcmApprovalRetryService,
    ApprovalReminderService,
    JobsScheduler,
  ],
})
export class JobsModule {}
