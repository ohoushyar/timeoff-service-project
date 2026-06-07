import type { FastifyRequest } from 'fastify';

export function paramId(request: FastifyRequest): string {
  return (request.params as { id: string }).id;
}
