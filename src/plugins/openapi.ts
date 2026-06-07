import fp from 'fastify-plugin';
import swagger from '@fastify/swagger';
import swaggerUi from '@fastify/swagger-ui';
import type { FastifyPluginAsync } from 'fastify';
import { loadOpenApiSpec } from '../openapi/load-spec.js';

const openapiPlugin: FastifyPluginAsync = async (fastify) => {
  const spec = loadOpenApiSpec();

  await fastify.register(swagger, { openapi: spec });
  await fastify.register(swaggerUi, {
    routePrefix: '/docs',
    uiConfig: {
      docExpansion: 'list',
      deepLinking: true,
    },
  });
};

export default fp(openapiPlugin, { name: 'openapi' });
