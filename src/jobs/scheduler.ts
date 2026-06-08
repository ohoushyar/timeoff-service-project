import cron from 'node-cron';
import type { FastifyInstance } from 'fastify';
import { runNightlyHcmSyncJob } from './nightly-hcm-sync.job.js';
import { runHcmApprovalRetryJob } from './hcm-approval-retry.job.js';
import { runApprovalReminderJob } from './approval-reminder.job.js';

export function startScheduler(app: FastifyInstance): void {
  const env = app.config;

  cron.schedule(env.CRON_NIGHTLY_HCM_SYNC, () => {
    runNightlyHcmSyncJob(app).catch((err) => app.log.error(err, 'nightly-hcm-sync failed'));
  });

  cron.schedule(env.CRON_HCM_APPROVAL_RETRY, () => {
    runHcmApprovalRetryJob(app).catch((err) => app.log.error(err, 'hcm-approval-retry failed'));
  });

  cron.schedule(env.CRON_APPROVAL_REMINDER, () => {
    runApprovalReminderJob(app).catch((err) => app.log.error(err, 'approval-reminder failed'));
  });
}

export { runNightlyHcmSyncJob, runHcmApprovalRetryJob, runApprovalReminderJob };
