import type { FastifyInstance } from 'fastify';
import { requireSelfOrPrivileged } from '../../auth/guards.js';
import { getEmployee } from '../../services/employee.service.js';
import { serializeEmployee } from '../../serializers/jsonapi/resources/employees.js';
import { JSON_API_CONTENT_TYPE } from '../../plugins/jsonapi.js';
import { paramId } from '../../lib/params.js';

export async function employeeRoutes(app: FastifyInstance): Promise<void> {
  app.get(
    '/api/v1/employees/:id',
    { preHandler: [app.authenticate] },
    async (request, reply) => {
      const id = paramId(request);
      await requireSelfOrPrivileged(request, reply, id);
      const employee = await getEmployee(app.prisma, id);
      return reply.type(JSON_API_CONTENT_TYPE).send(serializeEmployee(employee));
    },
  );
}
