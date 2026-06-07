import fp from 'fastify-plugin';
import type { FastifyPluginAsync } from 'fastify';
import { isAppError } from '../errors/app-error.js';

const JSON_API_CONTENT_TYPE = 'application/vnd.api+json';

const jsonApiPlugin: FastifyPluginAsync = async (fastify) => {
  fastify.addContentTypeParser(
    JSON_API_CONTENT_TYPE,
    { parseAs: 'string' },
    (_req, body, done) => {
      try {
        done(null, JSON.parse(body as string));
      } catch {
        done(new Error('Invalid JSON'), undefined);
      }
    },
  );

  fastify.setErrorHandler((error, request, reply) => {
    if (isAppError(error)) {
      return reply.status(error.httpStatus).type(JSON_API_CONTENT_TYPE).send({
        jsonapi: { version: '1.1' },
        errors: [error.toJsonApiError()],
        meta: { correlationId: request.correlationId },
      });
    }

    const fastifyError = error as { validation?: unknown; message?: string };
    if (fastifyError.validation) {
      return reply.status(400).type(JSON_API_CONTENT_TYPE).send({
        jsonapi: { version: '1.1' },
        errors: [
          {
            status: '400',
            code: 'VALIDATION_ERROR',
            title: 'Validation error',
            detail: fastifyError.message ?? 'Validation error',
          },
        ],
        meta: { correlationId: request.correlationId },
      });
    }

    request.log.error(error);
    return reply.status(500).type(JSON_API_CONTENT_TYPE).send({
      jsonapi: { version: '1.1' },
      errors: [
        {
          status: '500',
          code: 'VALIDATION_ERROR',
          title: 'Internal server error',
          detail: 'An unexpected error occurred',
        },
      ],
      meta: { correlationId: request.correlationId },
    });
  });
};

export default fp(jsonApiPlugin, { name: 'jsonapi' });
export { JSON_API_CONTENT_TYPE };
