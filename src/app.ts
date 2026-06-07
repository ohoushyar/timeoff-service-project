import Fastify from 'fastify';
import type { Env } from './config/env.js';
import prismaPlugin from './plugins/prisma.js';
import jwtPlugin from './plugins/jwt.js';
import jsonApiPlugin from './plugins/jsonapi.js';
import correlationIdPlugin from './plugins/correlation-id.js';
import { healthRoutes } from './routes/v1/health.js';
import { employeeRoutes } from './routes/v1/employees.js';
import { syncRoutes } from './routes/v1/sync.js';
import { leaveTypeRoutes } from './routes/v1/leave-types.js';
import { policyRoutes } from './routes/v1/policies.js';
import { leaveRequestRoutes } from './routes/v1/leave-requests.js';
import { approvalRoutes } from './routes/v1/approvals.js';
import { balanceRoutes } from './routes/v1/balances.js';
import { startScheduler } from './jobs/scheduler.js';
import { AppError } from './errors/app-error.js';

declare module 'fastify' {
  interface FastifyInstance {
    config: Env;
    authenticate: (request: import('fastify').FastifyRequest) => Promise<void>;
  }
}

export interface BuildAppOptions {
  env: Env;
  startJobs?: boolean;
  prisma?: import('@prisma/client').PrismaClient;
}

export async function buildApp(options: BuildAppOptions) {
  const app = Fastify({
    logger: { level: options.env.LOG_LEVEL },
  });

  app.decorate('config', options.env);

  await app.register(correlationIdPlugin);
  await app.register(prismaPlugin, { client: options.prisma });
  await app.register(jwtPlugin, { env: options.env });
  await app.register(jsonApiPlugin);

  app.decorate('authenticate', async (request: import('fastify').FastifyRequest) => {
    try {
      await request.jwtVerify();
    } catch {
      throw new AppError('AUTHENTICATION_REQUIRED');
    }
  });

  await app.register(healthRoutes);
  await app.register(employeeRoutes);
  await app.register(syncRoutes);
  await app.register(leaveTypeRoutes);
  await app.register(policyRoutes);
  await app.register(leaveRequestRoutes);
  await app.register(approvalRoutes);
  await app.register(balanceRoutes);

  if (options.startJobs) {
    startScheduler(app);
  }

  return app;
}
