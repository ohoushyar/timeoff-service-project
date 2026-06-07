import fp from 'fastify-plugin';
import type { FastifyPluginAsync } from 'fastify';
import { prisma as defaultPrisma } from '../lib/prisma.js';
import type { PrismaClient } from '@prisma/client';

declare module 'fastify' {
  interface FastifyInstance {
    prisma: PrismaClient;
  }
}

const prismaPlugin: FastifyPluginAsync<{ client?: PrismaClient }> = async (fastify, opts) => {
  const client = opts.client ?? defaultPrisma;
  fastify.decorate('prisma', client);

  fastify.addHook('onClose', async () => {
    if (!opts.client) {
      await defaultPrisma.$disconnect();
    }
  });
};

export default fp(prismaPlugin, { name: 'prisma' });
