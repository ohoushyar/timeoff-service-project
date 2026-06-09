import 'reflect-metadata';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import type { PrismaClient } from '@prisma/client';
import { Logger } from 'nestjs-pino';
import request from 'supertest';
import { AppModule } from '../../src/app.module.js';
import { configureApp } from '../../src/bootstrap.js';
import type { Role } from '../../src/auth/roles.js';
import { loadEnv, resetEnvCache } from '../../src/config/env.js';
import { PrismaService } from '../../src/prisma/prisma.service.js';

export function testEnv(overrides: Record<string, string> = {}) {
  resetEnvCache();
  const values = {
    NODE_ENV: 'test',
    DATABASE_URL: overrides.DATABASE_URL ?? 'file:./prisma/test.db',
    JWT_SECRET: 'test-secret',
    JWT_ISSUER: 'timeoff-service',
    JWT_AUDIENCE: 'timeoff-api',
    WORKDAY_TENANT_HOSTNAME: overrides.WORKDAY_TENANT_HOSTNAME ?? '127.0.0.1:4001',
    HCM_MOCK_MODE: 'true',
    LOG_LEVEL: 'error',
    ENABLE_JOBS: 'false',
    ...overrides,
  };
  for (const [key, value] of Object.entries(values)) {
    process.env[key] = value;
  }
  return loadEnv();
}

export interface TestAppContext {
  app: INestApplication;
  agent: ReturnType<typeof request>;
  jwt: JwtService;
  prisma: PrismaClient;
}

export async function buildTestApp(
  overrides?: Record<string, string>,
  prisma?: PrismaClient,
): Promise<TestAppContext> {
  testEnv(overrides);

  const moduleRef = await Test.createTestingModule({
    imports: [AppModule.register()],
  })
    .overrideProvider(PrismaService)
    .useValue(prisma)
    .compile();

  const app = moduleRef.createNestApplication({ bufferLogs: true });
  app.useLogger(app.get(Logger));
  await configureApp(app);
  await app.init();

  return {
    app,
    agent: request(app.getHttpServer()),
    jwt: moduleRef.get(JwtService),
    prisma: prisma!,
  };
}

export function signToken(
  jwt: JwtService,
  payload: { sub: string; roles: Role[]; employeeId?: string },
): string {
  const env = loadEnv();
  return jwt.sign(payload, {
    secret: env.JWT_SECRET,
    issuer: env.JWT_ISSUER,
    audience: env.JWT_AUDIENCE,
  });
}

export const JSON_API = 'application/vnd.api+json';
