import type { FastifyInstance } from 'fastify';
import { requireSelfOrPrivileged, requireManagerOfOrPrivileged, isPrivileged } from '../../auth/guards.js';
import { getEmployeeBalances } from '../../services/balance.service.js';
import { createHcmClient } from '../../integrations/hcm/workday/workday.adapter.js';
import { serializeBalances } from '../../serializers/jsonapi/resources/balances.js';
import { serializeLedgerEntries } from '../../serializers/jsonapi/resources/ledger.js';
import { JSON_API_CONTENT_TYPE } from '../../plugins/jsonapi.js';
import { parsePagination } from './leave-types.js';
import { paramId } from '../../lib/params.js';

export async function balanceRoutes(app: FastifyInstance): Promise<void> {
  app.get(
    '/api/v1/employees/:id/balances',
    { preHandler: [app.authenticate] },
    async (request, reply) => {
      const id = paramId(request);
      if (isPrivileged(request)) {
        await requireSelfOrPrivileged(request, reply, id);
      } else {
        await requireManagerOfOrPrivileged(request, reply, id);
      }
      const hcm = createHcmClient(app.config);
      const balances = await getEmployeeBalances(app.prisma, hcm, id, {
        refreshFromHcm: true,
      });
      const { pageNumber, pageSize } = parsePagination(request.query as Record<string, unknown>);
      return reply.type(JSON_API_CONTENT_TYPE).send(
        serializeBalances(balances, {
          basePath: `/api/v1/employees/${id}/balances`,
          pageNumber,
          pageSize,
          totalCount: balances.length,
        }),
      );
    },
  );

  app.get(
    '/api/v1/employees/:id/balance-ledger',
    { preHandler: [app.authenticate] },
    async (request, reply) => {
      const id = paramId(request);
      if (isPrivileged(request)) {
        await requireSelfOrPrivileged(request, reply, id);
      } else {
        await requireManagerOfOrPrivileged(request, reply, id);
      }
      const { pageNumber, pageSize } = parsePagination(request.query as Record<string, unknown>);
      const where = { employeeId: id };
      const [items, totalCount] = await Promise.all([
        app.prisma.leaveBalanceLedger.findMany({
          where,
          skip: (pageNumber - 1) * pageSize,
          take: pageSize,
          orderBy: { effectiveAt: 'desc' },
        }),
        app.prisma.leaveBalanceLedger.count({ where }),
      ]);
      return reply.type(JSON_API_CONTENT_TYPE).send(
        serializeLedgerEntries(items, {
          basePath: `/api/v1/employees/${id}/balance-ledger`,
          pageNumber,
          pageSize,
          totalCount,
        }),
      );
    },
  );
}
