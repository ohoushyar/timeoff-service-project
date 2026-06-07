import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { runTimeOffSync } from '../services/sync.service.js';
import { createHcmClient } from '../integrations/hcm/workday/workday.adapter.js';

export async function runNightlyHcmSyncJob(app: FastifyInstance): Promise<void> {
  const state = await app.prisma.timeOffSyncState.findFirst();
  if (state?.syncInProgress) {
    app.log.warn('Skipping nightly sync — already in progress');
    return;
  }

  const hcm = createHcmClient(app.config);
  await runTimeOffSync(app.prisma, hcm, {
    syncType: 'nightly',
    correlationId: randomUUID(),
  });
}
