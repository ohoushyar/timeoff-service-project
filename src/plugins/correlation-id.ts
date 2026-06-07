import { randomUUID } from 'node:crypto';
import fp from 'fastify-plugin';
import type { FastifyPluginAsync } from 'fastify';

declare module 'fastify' {
  interface FastifyRequest {
    correlationId: string;
  }
}

const correlationIdPlugin: FastifyPluginAsync = async (fastify) => {
  fastify.addHook('onRequest', async (request, reply) => {
    const header = request.headers['x-correlation-id'];
    const correlationId =
      typeof header === 'string' && header.length > 0 ? header : randomUUID();
    request.correlationId = correlationId;
    reply.header('X-Correlation-Id', correlationId);
  });
};

export default fp(correlationIdPlugin, { name: 'correlation-id' });
