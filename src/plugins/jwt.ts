import fp from 'fastify-plugin';
import fjwt from '@fastify/jwt';
import type { FastifyPluginAsync } from 'fastify';
import type { Env } from '../config/env.js';

const jwtPlugin: FastifyPluginAsync<{ env: Env }> = async (fastify, opts) => {
  await fastify.register(fjwt, {
    secret: opts.env.JWT_SECRET,
    verify: {
      allowedIss: opts.env.JWT_ISSUER,
      allowedAud: opts.env.JWT_AUDIENCE,
    },
  });
};

export default fp(jwtPlugin, { name: 'jwt' });
