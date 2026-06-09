import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import {
  setupIntegrationContext,
  teardownIntegrationContext,
  authHeaders,
  assertJsonApi,
  JSON_API,
  type IntegrationContext,
} from '../helpers/integration.js';
import { buildTestApp, signToken } from '../helpers/app.js';
import { setupTestDb, teardownTestDb, getTestDatabaseUrl } from '../helpers/db.js';

const PROTECTED_ROUTES = [
  { method: 'GET' as const, url: '/api/v1/leave-types' },
  { method: 'GET' as const, url: '/api/v1/employees/00000000-0000-4000-8000-000000000001' },
  { method: 'GET' as const, url: '/api/v1/sync/status' },
  { method: 'POST' as const, url: '/api/v1/sync/time-off' },
  { method: 'GET' as const, url: '/api/v1/policies' },
  { method: 'GET' as const, url: '/api/v1/leave-requests' },
  { method: 'GET' as const, url: '/api/v1/approvals/pending' },
];

describe('IT-1.18 cross-cutting', () => {
  let ctx: IntegrationContext;

  beforeAll(async () => {
    ctx = await setupIntegrationContext();
  });

  afterAll(async () => {
    await teardownIntegrationContext(ctx);
  });

  it('protected routes return 401 without JWT with JSON:API errors', async () => {
    for (const route of PROTECTED_ROUTES) {
      const res = await ctx.inject({ method: route.method, url: route.url });
      expect(res.statusCode).toBe(401);
      const body = res.json();
      expect(body.errors).toBeDefined();
      expect(body.jsonapi.version).toBe('1.1');
    }
  });

  it('audit records exclude email addresses', async () => {
    const logs = await ctx.prisma.auditLog.findMany();
    for (const log of logs) {
      const serialized = JSON.stringify(log);
      expect(serialized).not.toContain('alice.employee@example.com');
      expect(serialized).not.toContain('bob.manager@example.com');
      expect(serialized).not.toContain('carol.hr@example.com');
    }
  });

  it('JSON:API content type on representative endpoints', async () => {
    const token = ctx.token('employee', { sub: 'alice', employeeId: ctx.aliceId });
    const res = await ctx.inject({
      method: 'GET',
      url: '/api/v1/leave-types',
      headers: authHeaders(token, ''),
    });
    expect(res.headers['content-type']).toContain(JSON_API);
    assertJsonApi(res);
  });
});

describe('§14.2 EMPLOYEE_NOT_FOUND before sync', () => {
  let ctx: Awaited<ReturnType<typeof buildTestApp>>;
  let prisma: Awaited<ReturnType<typeof setupTestDb>>;

  beforeAll(async () => {
    prisma = await setupTestDb();
    ctx = await buildTestApp({ DATABASE_URL: getTestDatabaseUrl() }, prisma);
  });

  afterAll(async () => {
    await ctx.app.close();
    await teardownTestDb(prisma);
  });

  it('returns 404 when employee mapping missing before sync', async () => {
    const token = signToken(ctx.jwt, { sub: 'admin', roles: ['hr_admin'] });
    const res = await ctx.agent
      .get('/api/v1/employees/00000000-0000-4000-8000-000000000099')
      .set('authorization', `Bearer ${token}`)
      .set('accept', JSON_API);
    expect(res.status).toBe(404);
  });
});
