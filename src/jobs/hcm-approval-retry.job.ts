import type { FastifyInstance } from 'fastify';
import { retryPendingHcmUpdates } from '../services/approval.service.js';
import { createHcmClient } from '../integrations/hcm/workday/workday.adapter.js';

export async function runHcmApprovalRetryJob(app: FastifyInstance): Promise<void> {
  const hcm = createHcmClient(app.config);
  const result = await retryPendingHcmUpdates(app.prisma, hcm, app.config);
  app.log.info(result, 'hcm-approval-retry completed');
}
