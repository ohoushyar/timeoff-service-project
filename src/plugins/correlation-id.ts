import { randomUUID } from 'node:crypto';
import type { IncomingMessage } from 'node:http';
import fp from 'fastify-plugin';
import type { FastifyPluginAsync } from 'fastify';

declare module 'fastify' {
  interface FastifyRequest {
    correlationId: string;
  }
}

const kCorrelationId = Symbol('correlationId');

type RawRequestWithCorrelationId = IncomingMessage & {
  [kCorrelationId]?: string;
};

export function resolveCorrelationId(
  header: string | string[] | undefined,
): string {
  if (typeof header === 'string' && header.length > 0) {
    return header;
  }
  return randomUUID();
}

function stashCorrelationId(rawReq: IncomingMessage, correlationId: string): void {
  (rawReq as RawRequestWithCorrelationId)[kCorrelationId] = correlationId;
}

function readStashedCorrelationId(rawReq: IncomingMessage): string | undefined {
  return (rawReq as RawRequestWithCorrelationId)[kCorrelationId];
}

const correlationIdPlugin: FastifyPluginAsync = async (fastify) => {
  const previousFactory = fastify.childLoggerFactory.bind(fastify);

  fastify.setChildLoggerFactory((logger, bindings, opts, rawReq) => {
    const correlationId = resolveCorrelationId(rawReq.headers['x-correlation-id']);
    stashCorrelationId(rawReq, correlationId);
    return previousFactory(
      logger,
      { ...bindings, correlationId },
      opts,
      rawReq,
    );
  });

  fastify.addHook('onRequest', async (request, reply) => {
    const correlationId =
      readStashedCorrelationId(request.raw) ??
      resolveCorrelationId(request.headers['x-correlation-id']);
    request.correlationId = correlationId;
    reply.header('X-Correlation-Id', correlationId);
  });
};

export default fp(correlationIdPlugin, { name: 'correlation-id' });
